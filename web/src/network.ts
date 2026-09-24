type ConnectionInfo = {
  saveData?: boolean
  type?: string
  effectiveType?: string
}

/** Match the existing pre-generated-preview confirmation threshold. */
export const LARGE_DOWNLOAD_CONFIRM_BYTES = 1_000_000

/** Browser support is optional; an unknown connection does not imply cellular. */
export function shouldConfirmCadDownload(connection?: ConnectionInfo) {
  return connection?.saveData === true || connection?.type === 'cellular' || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g'
}

export function currentConnectionNeedsConfirmation() {
  return shouldConfirmCadDownload((navigator as Navigator & { connection?: ConnectionInfo }).connection)
}

export function shouldConfirmLargeDownload(bytes: number, connection?: ConnectionInfo) {
  return bytes >= LARGE_DOWNLOAD_CONFIRM_BYTES && shouldConfirmCadDownload(connection)
}

export function currentConnectionNeedsLargeDownloadConfirmation(bytes: number) {
  return shouldConfirmLargeDownload(bytes, (navigator as Navigator & { connection?: ConnectionInfo }).connection)
}
