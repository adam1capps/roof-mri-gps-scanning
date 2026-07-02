import { PermissionsAndroid, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { launchCamera } from 'react-native-image-picker';
import { newId } from '../core/capture/model';
import { PhotoAttachment } from '../core/capture/moisture';
import { useAppStore } from '../state/useAppStore';

/**
 * Roof photos (including core samples): shot with the camera, moved into the
 * project's folder, geotagged with the current RX2 position when available,
 * and listed in the report request.
 */

async function requestCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

export async function capturePhoto(kind: 'photo' | 'core-sample'): Promise<PhotoAttachment | null> {
  const store = useAppStore.getState();
  if (!store.activeProjectId) return null;
  if (!(await requestCameraPermission())) return null;

  const result = await launchCamera({
    mediaType: 'photo',
    quality: 0.8,
    saveToPhotos: false,
  });
  const asset = result.assets?.[0];
  if (!asset?.uri) return null;

  const dir = `${RNFS.DocumentDirectoryPath}/projects/${store.activeProjectId}/photos`;
  await RNFS.mkdir(dir);
  const id = newId('ph');
  const ext = (asset.fileName?.split('.').pop() ?? 'jpg').toLowerCase();
  const dest = `${dir}/${id}_${kind}.${ext}`;
  await RNFS.moveFile(asset.uri.replace('file://', ''), dest);

  const gga = store.lastEpoch?.gga;
  const photo: PhotoAttachment = {
    id,
    path: dest,
    kind,
    lat: gga && Number.isFinite(gga.latitude) ? gga.latitude : undefined,
    lon: gga && Number.isFinite(gga.longitude) ? gga.longitude : undefined,
    takenAt: new Date().toISOString(),
  };
  store.addPhoto(photo);
  return photo;
}
