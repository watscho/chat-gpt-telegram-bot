import type { Config } from '../config.js'
import type { SuiteAssetPorts } from '../domain/suite.js'
import { organizeArchive, writeArchive } from './archive.js'
import {
  BrandedDocuments,
  annotateScreenshot,
  templateFromDocument
} from './branded-documents.js'
import { VideoExtractor } from './video-evidence.js'
export function suiteAssets(config: Config): SuiteAssetPorts {
  const documents = new BrandedDocuments(config.maxExportBytes),
    video = new VideoExtractor(config)
  return {
    archive: bytes => organizeArchive(bytes, config.maxDocumentBytes),
    package: items => writeArchive(items, config.maxExportBytes),
    document: (template, format, title, sections) =>
      documents.render(template, format, title, sections),
    annotate: (image, rows) =>
      Promise.resolve(annotateScreenshot(image, rows, config.maxExportBytes)),
    template: (file, name) =>
      templateFromDocument(file, name, config.maxProjectBytes),
    video: (bytes, reference, signal) => video.extract(bytes, reference, signal)
  }
}
