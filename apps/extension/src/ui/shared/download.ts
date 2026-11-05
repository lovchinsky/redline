/** Saves a blob through the browser's download flow, as if the user clicked a link. */
export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoke after the download has started reading the URL.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
};
