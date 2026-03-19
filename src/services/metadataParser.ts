export const buildSongId = (path: string): string => {
  return path.toLowerCase().replace(/[^a-z0-9]/g, '_');
};
