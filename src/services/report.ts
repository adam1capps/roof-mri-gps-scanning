import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { RoofProject } from '../core/capture/model';
import { readingsToCsv } from '../core/export/csv';
import { projectToGeoJson } from '../core/export/geojson';
import { buildReportRequest } from '../core/report/manifest';
import { useAppStore } from '../state/useAppStore';

/**
 * Report request submission to the Roof MRI Report Creation Team.
 *
 * Delivery is two-channel:
 *  1. If a webhook URL is configured (Settings), the manifest JSON is POSTed
 *     there — the intake endpoint for the report team's system.
 *  2. The share sheet opens with the full package (manifest, GeoJSON,
 *     readings CSV, photos) so the contractor can email it (default address
 *     from Settings) — also the fallback when there's no connectivity to the
 *     webhook; nothing is lost, the files stay in the project folder.
 */

export interface SubmitResult {
  webhookDelivered: boolean;
  webhookError?: string;
  packageFiles: string[];
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, '_').toLowerCase() || 'roof';
}

export async function submitReportRequest(project: RoofProject): Promise<SubmitResult> {
  const { settings } = useAppStore.getState();
  const geojson = projectToGeoJson(project);
  const manifest = buildReportRequest(project, geojson);

  const base = safeName(project.name);
  const dir = `${RNFS.DocumentDirectoryPath}/reports/${base}`;
  await RNFS.mkdir(dir);

  const files: string[] = [];
  const write = async (name: string, content: string) => {
    const path = `${dir}/${name}`;
    await RNFS.writeFile(path, content, 'utf8');
    files.push(path);
  };

  await write(`${base}_report_request.json`, JSON.stringify(manifest, null, 2));
  await write(`${base}.geojson`, geojson);
  await write(`${base}_readings.csv`, readingsToCsv(project));
  for (const photo of project.photos ?? []) {
    if (await RNFS.exists(photo.path)) files.push(photo.path);
  }

  let webhookDelivered = false;
  let webhookError: string | undefined;
  const url = settings.reportWebhookUrl.trim();
  if (url) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest),
      });
      webhookDelivered = res.ok;
      if (!res.ok) webhookError = `HTTP ${res.status}`;
    } catch (e) {
      webhookError = String(e);
    }
  }

  await Share.open({
    title: `Roof MRI report request — ${project.name}`,
    subject: `Roof MRI report request — ${project.name}`,
    message: `Report request for "${project.name}". Send to ${settings.reportEmail}.`,
    urls: files.map(p => `file://${p}`),
    failOnCancel: false,
  });

  useAppStore.getState().markReportSubmitted();
  return { webhookDelivered, webhookError, packageFiles: files };
}
