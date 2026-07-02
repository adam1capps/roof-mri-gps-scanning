import RNBluetoothClassic, {
  BluetoothDevice,
} from 'react-native-bluetooth-classic';
import { Platform } from 'react-native';
import { bytesToBase64 } from '../core/util/base64';

/**
 * Bluetooth link to the Reach RX2.
 *
 * Android: Bluetooth Classic SPP (RFCOMM). NMEA arrives as text; RTCM3
 * corrections are written back on the same socket.
 *
 * iOS: External Accessory framework (the RX2 is MFi certified). The NMEA
 * stream uses protocol "com.emlid.nmea"; corrections go to
 * "com.emlid.corrections". Both protocol strings are declared in Info.plist
 * (UISupportedExternalAccessoryProtocols). Before App Store release, email
 * developers@emlid.com with the app bundle ID for accessory whitelisting.
 */

export const EMLID_PROTOCOL_NMEA = 'com.emlid.nmea';
export const EMLID_PROTOCOL_CORRECTIONS = 'com.emlid.corrections';

export interface BtDeviceInfo {
  address: string;
  name: string;
}

export type BtConnectionState = 'disconnected' | 'connecting' | 'connected';

export class EmlidBluetoothLink {
  private device: BluetoothDevice | null = null;
  private correctionsDevice: BluetoothDevice | null = null;
  private subscriptions: Array<{ remove(): void }> = [];

  constructor(
    private readonly onText: (chunk: string) => void,
    private readonly onStateChange: (state: BtConnectionState, deviceName?: string) => void,
  ) {}

  /** Bonded devices (Android) / connected MFi accessories (iOS). */
  async listDevices(): Promise<BtDeviceInfo[]> {
    const devices: BluetoothDevice[] = [];
    try {
      if (Platform.OS === 'android') {
        devices.push(...(await RNBluetoothClassic.getBondedDevices()));
      } else {
        devices.push(...(await RNBluetoothClassic.getConnectedDevices()));
      }
    } catch {
      // Bluetooth off / permission missing — caller shows the empty state.
    }
    return devices.map(d => ({ address: d.address, name: d.name ?? d.address }));
  }

  async connect(address: string): Promise<void> {
    this.onStateChange('connecting');
    try {
      const device = await RNBluetoothClassic.connectToDevice(address, {
        // Android SPP options; harmless extras are ignored on iOS.
        delimiter: '\n',
        charset: 'ascii',
        // iOS External Accessory: read the NMEA protocol stream.
        protocolString: EMLID_PROTOCOL_NMEA,
      } as never);
      this.device = device;

      this.subscriptions.push(
        device.onDataReceived(event => {
          // With a '\n' delimiter the library emits per-line; re-append it so
          // the stream parser can frame uniformly.
          this.onText(event.data.endsWith('\n') ? event.data : event.data + '\n');
        }),
      );
      this.subscriptions.push(
        RNBluetoothClassic.onDeviceDisconnected(() => this.handleDisconnect()),
      );

      // iOS: corrections are a separate External Accessory session.
      if (Platform.OS === 'ios') {
        try {
          this.correctionsDevice = await RNBluetoothClassic.connectToDevice(address, {
            protocolString: EMLID_PROTOCOL_CORRECTIONS,
          } as never);
        } catch {
          // Not fatal: corrections can also come from Emlid Flow in background.
          this.correctionsDevice = null;
        }
      }

      this.onStateChange('connected', device.name ?? address);
    } catch (e) {
      this.onStateChange('disconnected');
      throw e;
    }
  }

  /** Forward binary RTCM3 corrections to the receiver. */
  async writeRtcm(bytes: Uint8Array): Promise<void> {
    const target =
      Platform.OS === 'ios' ? this.correctionsDevice ?? this.device : this.device;
    if (!target) return;
    await target.write(bytesToBase64(bytes), 'base64');
  }

  async disconnect(): Promise<void> {
    for (const s of this.subscriptions) s.remove();
    this.subscriptions = [];
    try {
      await this.device?.disconnect();
      await this.correctionsDevice?.disconnect();
    } catch {
      // already gone
    }
    this.device = null;
    this.correctionsDevice = null;
    this.onStateChange('disconnected');
  }

  get connected(): boolean {
    return this.device !== null;
  }

  private handleDisconnect(): void {
    this.device = null;
    this.correctionsDevice = null;
    for (const s of this.subscriptions) s.remove();
    this.subscriptions = [];
    this.onStateChange('disconnected');
  }
}
