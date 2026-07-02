import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { RoofProject } from '../core/capture/model';
import { projectToCsv } from '../core/export/csv';
import { projectToDxf, DxfOptions } from '../core/export/dxf';
import { projectToGeoJson } from '../core/export/geojson';
import { projectToShapefiles } from '../core/export/shp';
import { bytesToBase64 } from '../core/util/base64';

export interface ExportSelection {
  csv: boolean;
  geojson: boolean;
  dxf: boolean;
  shp: boolean;
  dxfOptions: DxfOptions;
}

export interface ExportResult {
  files: string[];
  directory: string;
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, '_').toLowerCase() || 'roof';
}

/** Writes the selected formats to Documents/exports/<project>/ and returns paths. */
export async function exportProject(
  project: RoofProject,
  selection: ExportSelection,
): Promise<ExportResult> {
  const base = safeName(project.name);
  const dir = `${RNFS.DocumentDirectoryPath}/exports/${base}`;
  await RNFS.mkdir(dir);

  const files: string[] = [];
  const write = async (name: string, content: string, encoding: 'utf8' | 'base64') => {
    const path = `${dir}/${name}`;
    await RNFS.writeFile(path, content, encoding);
    files.push(path);
  };

  if (selection.csv) {
    await write(`${base}_points.csv`, projectToCsv(project), 'utf8');
  }
  if (selection.geojson) {
    await write(`${base}.geojson`, projectToGeoJson(project), 'utf8');
  }
  if (selection.dxf) {
    await write(`${base}.dxf`, projectToDxf(project, selection.dxfOptions), 'utf8');
  }
  if (selection.shp) {
    for (const set of projectToShapefiles(project)) {
      await write(`${set.baseName}.shp`, bytesToBase64(set.shp), 'base64');
      await write(`${set.baseName}.shx`, bytesToBase64(set.shx), 'base64');
      await write(`${set.baseName}.dbf`, bytesToBase64(set.dbf), 'base64');
      await write(`${set.baseName}.prj`, set.prj, 'utf8');
    }
  }

  return { files, directory: dir };
}

/** Opens the platform share sheet with the exported files. */
export async function shareFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await Share.open({
    title: 'Export roof measurement',
    urls: paths.map(p => (p.startsWith('file://') ? p : `file://${p}`)),
    failOnCancel: false,
  });
}
