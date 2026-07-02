import { PointAverager } from '../core/gnss/averager';
import { evaluateEpoch, GateConfig } from '../core/gnss/gate';
import { EpochAssembler } from '../core/nmea/epoch';
import { NmeaStreamParser } from '../core/nmea/stream';
import { GnssEpoch } from '../core/nmea/types';
import { NtripClient } from '../core/ntrip/client';
import { RtcmSplitter } from '../core/ntrip/rtcm';
import { EmlidBluetoothLink } from '../device/EmlidBluetooth';
import { TcpNtripTransport } from '../device/TcpNtripTransport';
import { useAppStore } from '../state/useAppStore';

/**
 * Singleton orchestrator binding the data pipeline together:
 *
 *   RX2 ──BT──▶ NmeaStreamParser ──▶ EpochAssembler ──▶ fix gate ──▶ store
 *                     │ (raw GGA)                          │ (averaging)
 *                     ▼                                    ▼
 *   caster ◀──GGA── NtripClient ──RTCM3──▶ RX2       captured vertex
 */
class GnssController {
  private link: EmlidBluetoothLink | null = null;
  private ntrip: NtripClient | null = null;
  private averager: PointAverager | null = null;
  private lastRawGga: string | null = null;

  private readonly rtcmSplitter = new RtcmSplitter(frame =>
    useAppStore.getState().countRtcm(frame.messageType),
  );

  private readonly assembler = new EpochAssembler(epoch => this.handleEpoch(epoch));

  private readonly parser = new NmeaStreamParser(sentence => {
    if (sentence.kind === 'GGA') {
      this.lastRawGga = sentence.raw;
      this.ntrip?.updateGga(sentence.raw);
    }
    this.assembler.feed(sentence);
  });

  // ---- Receiver ----------------------------------------------------------

  async listDevices() {
    return this.ensureLink().listDevices();
  }

  async connectDevice(address: string): Promise<void> {
    await this.ensureLink().connect(address);
  }

  async disconnectDevice(): Promise<void> {
    await this.link?.disconnect();
    this.assembler.reset();
    this.parser.reset();
  }

  private ensureLink(): EmlidBluetoothLink {
    if (!this.link) {
      this.link = new EmlidBluetoothLink(
        chunk => this.parser.feed(chunk),
        (state, name) => useAppStore.getState().setBtState(state, name),
      );
    }
    return this.link;
  }

  // ---- Corrections (NTRIP) ----------------------------------------------

  async connectNtrip(): Promise<void> {
    const { settings } = useAppStore.getState();
    this.disconnectNtrip();

    this.ntrip = new NtripClient(
      new TcpNtripTransport(),
      {
        host: settings.ntrip.host,
        port: settings.ntrip.port,
        mountpoint: settings.ntrip.mountpoint,
        username: settings.ntrip.username || undefined,
        password: settings.ntrip.password || undefined,
        ggaIntervalS: settings.ntrip.ggaIntervalS,
      },
      {
        onRtcm: bytes => {
          this.rtcmSplitter.feed(bytes);
          this.link?.writeRtcm(bytes).catch(() => {
            // BT write failure surfaces via the connection state listener.
          });
        },
        onStatus: status => useAppStore.getState().setNtripStatus(status),
        onSourceTable: entries => useAppStore.getState().setSourceTable(entries),
      },
    );
    if (this.lastRawGga) this.ntrip.updateGga(this.lastRawGga);
    await this.ntrip.connect();
  }

  /** Connect with an empty mountpoint to browse the caster's sourcetable. */
  async fetchSourceTable(): Promise<void> {
    const { settings } = useAppStore.getState();
    const probe = new NtripClient(
      new TcpNtripTransport(),
      { ...settings.ntrip, mountpoint: '', username: settings.ntrip.username || undefined, password: settings.ntrip.password || undefined },
      {
        onRtcm: () => {},
        onStatus: status => useAppStore.getState().setNtripStatus(status),
        onSourceTable: entries => useAppStore.getState().setSourceTable(entries),
      },
    );
    await probe.connect();
  }

  disconnectNtrip(): void {
    this.ntrip?.disconnect();
    this.ntrip = null;
    this.rtcmSplitter.reset();
  }

  // ---- Capture -----------------------------------------------------------

  /**
   * Starts capturing a vertex: with averaging N > 1, the next N accepted
   * epochs are averaged; with N = 1 the next accepted epoch is used.
   */
  capturePoint(): void {
    const state = useAppStore.getState();
    if (!state.activeProjectId) return;
    if (!state.activeFeatureId) {
      state.beginFeature(state.activeKind);
    }
    const target = Math.max(1, state.settings.averagingEpochs);
    this.averager = new PointAverager(target);
    useAppStore.getState().setAveraging({
      featureId: useAppStore.getState().activeFeatureId!,
      collected: 0,
      target,
    });
  }

  cancelCapture(): void {
    this.averager = null;
    useAppStore.getState().setAveraging(null);
  }

  private gateConfig(): GateConfig {
    const { settings } = useAppStore.getState();
    return {
      maxHorizontalSigmaM: settings.maxHorizontalSigmaM,
      tiltMode: settings.tiltMode,
      poleHeightM: settings.poleHeightM,
      rejectFastMotion: settings.rejectFastMotion,
      requireGst: true,
    };
  }

  private handleEpoch(epoch: GnssEpoch): void {
    const gate = evaluateEpoch(epoch, this.gateConfig());
    const store = useAppStore.getState();
    store.setEpoch(epoch, gate);

    if (!this.averager || !gate.accepted || !gate.point) return;

    this.averager.add(gate.point);
    const collected = this.averager.count;
    const averaging = store.averaging;
    if (averaging) {
      store.setAveraging({ ...averaging, collected });
    }

    if (this.averager.done) {
      const result = this.averager.result();
      this.averager = null;
      if (result) {
        store.commitVertex(result, collected);
      } else {
        store.setAveraging(null);
      }
    }
  }

  /** Test hook: inject raw NMEA text as if it came from the receiver. */
  injectNmea(text: string): void {
    this.parser.feed(text);
  }
}

export const gnssController = new GnssController();
