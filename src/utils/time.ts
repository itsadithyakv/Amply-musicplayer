export const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const formatDateLabel = (timestamp: number): string => {
  if (!timestamp) {
    return '-';
  }

  return new Date(timestamp * 1000).toLocaleDateString();
};
