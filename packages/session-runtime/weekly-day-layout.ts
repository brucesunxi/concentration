/** Day tiles grow across the card. Content width alone left the right side of a 720px row empty. */
export const weeklyDayLayout = {
  row: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10, width: '100%' as const, alignItems: 'stretch' as const },
  tile: { flexGrow: 1, flexShrink: 1, flexBasis: '46%' as const },
};
