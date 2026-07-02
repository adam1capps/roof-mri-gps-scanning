import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { gnssController } from '../../app/GnssController';
import { fixQualityLabel } from '../../core/gnss/gate';
import type { BtDeviceInfo } from '../../device/EmlidBluetooth';
import { useAppStore } from '../../state/useAppStore';
import { Button, Field, Row, Section } from '../components';
import { colors, spacing } from '../theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Connect'>;

async function requestBtPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const wanted = [
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ].filter(Boolean);
  const results = await PermissionsAndroid.requestMultiple(wanted);
  return Object.values(results).every(
    r => r === PermissionsAndroid.RESULTS.GRANTED || r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
  );
}

export function ConnectScreen(_props: Props) {
  const store = useAppStore();
  const [devices, setDevices] = useState<BtDeviceInfo[]>([]);
  const [busyAddress, setBusyAddress] = useState<string | null>(null);
  const [ntripBusy, setNtripBusy] = useState(false);

  const refresh = useCallback(async () => {
    await requestBtPermissions();
    setDevices(await gnssController.listDevices());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const connect = async (d: BtDeviceInfo) => {
    setBusyAddress(d.address);
    try {
      await gnssController.connectDevice(d.address);
    } catch (e) {
      Alert.alert('Connection failed', String(e));
    } finally {
      setBusyAddress(null);
    }
  };

  const epoch = store.lastEpoch;
  const ntrip = store.ntripStatus;
  const rtcmSummary = Object.entries(store.rtcmMessageCounts)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([type, count]) => `${type}×${count}`)
    .join('  ');

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: spacing(4) }}>
      <Section title="Reach RX2 receiver">
        {store.btState === 'connected' ? (
          <>
            <Text style={styles.connected}>Connected: {store.btDeviceName}</Text>
            {epoch && (
              <Text style={styles.dim}>
                {fixQualityLabel(epoch.gga.quality)} · {epoch.gga.satellites} sats ·{' '}
                {Number.isFinite(epoch.gga.diffAge) ? `corr. age ${epoch.gga.diffAge.toFixed(0)}s` : 'no corrections'}
              </Text>
            )}
            <Button title="Disconnect" tone="danger" onPress={() => gnssController.disconnectDevice()} />
          </>
        ) : (
          <>
            <Text style={styles.dim}>
              {Platform.OS === 'android'
                ? 'Pair the RX2 in Android Bluetooth settings first, then select it below.'
                : 'Pair the RX2 in iOS Bluetooth settings; it appears here once connected.'}
            </Text>
            <FlatList
              data={devices}
              scrollEnabled={false}
              keyExtractor={d => d.address}
              ListEmptyComponent={<Text style={styles.dim}>No paired devices found.</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.deviceRow}
                  disabled={busyAddress !== null}
                  onPress={() => connect(item)}>
                  <Text style={styles.deviceName}>
                    {busyAddress === item.address ? 'Connecting…  ' : ''}
                    {item.name}
                  </Text>
                  <Text style={styles.dim}>{item.address}</Text>
                </TouchableOpacity>
              )}
            />
            <Button title="Refresh list" tone="neutral" onPress={refresh} />
          </>
        )}
      </Section>

      <Section title="RTK corrections (NTRIP)">
        <Text style={styles.dim}>
          Option A: run Emlid Flow in the background supplying corrections (free).{'\n'}
          Option B: connect this app directly to your caster below — the received RTCM3 is
          forwarded to the RX2 and your position (GGA) is sent upstream for VRS.
        </Text>
        <Field
          label="Caster host"
          value={store.settings.ntrip.host}
          onChangeText={v => store.updateNtripSettings({ host: v.trim() })}
          placeholder="e.g. rtk2go.com or your state CORS"
          keyboardType="url"
        />
        <Row>
          <View style={{ flex: 1, marginRight: spacing(1) }}>
            <Field
              label="Port"
              value={String(store.settings.ntrip.port)}
              onChangeText={v => store.updateNtripSettings({ port: parseInt(v, 10) || 2101 })}
              keyboardType="number-pad"
            />
          </View>
          <View style={{ flex: 2 }}>
            <Field
              label="Mount point"
              value={store.settings.ntrip.mountpoint}
              onChangeText={v => store.updateNtripSettings({ mountpoint: v.trim() })}
            />
          </View>
        </Row>
        <Field
          label="Username"
          value={store.settings.ntrip.username}
          onChangeText={v => store.updateNtripSettings({ username: v })}
        />
        <Field
          label="Password"
          value={store.settings.ntrip.password}
          onChangeText={v => store.updateNtripSettings({ password: v })}
          secureTextEntry
        />

        {ntrip && (
          <Text style={[styles.dim, { marginBottom: spacing(1) }]}>
            Status: {ntrip.phase}
            {ntrip.message ? ` — ${ntrip.message}` : ''}
            {ntrip.phase === 'streaming'
              ? ` · ${(ntrip.bytesReceived / 1024).toFixed(0)} KB received`
              : ''}
            {rtcmSummary ? `\nRTCM: ${rtcmSummary}` : ''}
          </Text>
        )}

        {ntrip?.phase === 'streaming' || ntrip?.phase === 'connecting' || ntrip?.phase === 'handshake' ? (
          <Button title="Disconnect NTRIP" tone="danger" onPress={() => gnssController.disconnectNtrip()} />
        ) : (
          <Button
            title="Connect NTRIP"
            busy={ntripBusy}
            disabled={!store.settings.ntrip.host || !store.settings.ntrip.mountpoint}
            onPress={async () => {
              setNtripBusy(true);
              try {
                await gnssController.connectNtrip();
              } catch (e) {
                Alert.alert('NTRIP failed', String(e));
              } finally {
                setNtripBusy(false);
              }
            }}
          />
        )}
        <Button
          title="Browse mount points"
          tone="neutral"
          disabled={!store.settings.ntrip.host}
          onPress={async () => {
            try {
              await gnssController.fetchSourceTable();
            } catch (e) {
              Alert.alert('Source table failed', String(e));
            }
          }}
        />
        {store.sourceTable && (
          <View style={{ marginTop: spacing(1) }}>
            {store.sourceTable.slice(0, 30).map(entry => (
              <TouchableOpacity
                key={entry.mountpoint}
                style={styles.deviceRow}
                onPress={() => {
                  store.updateNtripSettings({ mountpoint: entry.mountpoint });
                  store.setSourceTable(null);
                }}>
                <Text style={styles.deviceName}>{entry.mountpoint}</Text>
                <Text style={styles.dim}>
                  {entry.format} · {entry.navSystem} {entry.nmeaRequired ? '· needs GGA (VRS)' : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  dim: { color: colors.textDim, fontSize: 13, marginBottom: spacing(1) },
  connected: { color: colors.primary, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  deviceRow: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(1.5),
    marginBottom: spacing(1),
  },
  deviceName: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
