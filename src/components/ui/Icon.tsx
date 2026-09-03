import type { FC, SVGProps } from 'react';
import clsx from 'clsx';

/**
 * Single source of truth for Amply's icon set.
 *
 * Every entry is drawn on a 24x24 grid. Stroked icons inherit the <svg>
 * stroke (currentColor, 1.8 wide, round caps/joins); `filled` icons paint
 * their paths with currentColor and no stroke instead.
 *
 * `d` is either one path or a list of paths rendered as sibling <path>s.
 */
interface IconDef {
  d: string | string[];
  filled?: boolean;
}

const CIRCLE_9 = 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z';
const HEART =
  'M12 20.4L10.3 18.9C6.6 15.5 4.2 13.2 4.2 10.2C4.2 8.1 5.8 6.5 7.9 6.5C9.2 6.5 10.4 7.1 11.2 8.1C12 7.1 13.2 6.5 14.5 6.5C16.6 6.5 18.2 8.1 18.2 10.2C18.2 13.2 15.8 15.5 12.1 18.9L12 19L12 20.4Z';
const SPEAKER = 'M11 5 6 9H2v6h4l5 4V5Z';
const MOON = 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z';
/** A solid dot centred at (cx, cy); the stroke makes it ~2px wide. */
const dot = (cx: number, cy: number) => `M${cx + 0.5} ${cy}a.5 .5 0 1 1-1 0 .5 .5 0 0 1 1 0Z`;

const ICONS = {
  // --- Existing icons, ported from src/assets/icons/*.svg ------------------
  add: { d: ['M12 6V18', 'M6 12H18'] },
  home: { d: 'M3 10.5L12 3L21 10.5V20A1 1 0 0 1 20 21H14V14H10V21H4A1 1 0 0 1 3 20V10.5Z' },
  library: {
    d: [
      'M5 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
      'M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    ],
  },
  lyrics: {
    d: [
      'M6.5 4h11a2.5 2.5 0 0 1 2.5 2.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4Z',
      'M8 9H16',
      'M8 13H12.5',
      'M8 17H14',
    ],
  },
  next: { d: ['M6 6V18L15 12L6 6Z', 'M14 6V18L23 12L14 6Z'], filled: true },
  pause: {
    d: [
      'M7 5h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
      'M15 5h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
    ],
    filled: true,
  },
  play: { d: 'M7 5V19L19 12L7 5Z', filled: true },
  playlists: { d: ['M4 6H20', 'M4 12H20', 'M4 18H13', 'M20 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z'] },
  prev: { d: ['M18 6V18L9 12L18 6Z', 'M10 6V18L1 12L10 6Z'], filled: true },
  queue: { d: ['M5 7H15', 'M5 12H13', 'M5 17H11', 'M18 8V16', 'M16.5 14.5L18 16L19.5 14.5'] },
  repeat: { d: ['M20 4V10H14', 'M4 20V14H10', 'M5 5L19 19'] },
  'repeat-on': { d: ['M20 4V10H14', 'M4 20V14H10'] },
  search: { d: ['M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z', 'M20 20L16.6 16.6'] },
  settings: {
    d: [
      'M19.4 12a7.4 7.4 0 0 0-.08-1.08l2.06-1.6a.5.5 0 0 0 .12-.64l-1.95-3.37a.5.5 0 0 0-.6-.22l-2.42.98a7.43 7.43 0 0 0-1.87-1.08l-.36-2.57A.5.5 0 0 0 13.8 2h-3.6a.5.5 0 0 0-.5.42l-.36 2.57c-.66.27-1.29.64-1.87 1.08l-2.42-.98a.5.5 0 0 0-.6.22L2.5 8.68a.5.5 0 0 0 .12.64l2.06 1.6c-.05.35-.08.7-.08 1.08s.03.73.08 1.08l-2.06 1.6a.5.5 0 0 0-.12.64l1.95 3.37a.5.5 0 0 0 .6.22l2.42-.98c.58.44 1.21.81 1.87 1.08l.36 2.57a.5.5 0 0 0 .5.42h3.6a.5.5 0 0 0 .5-.42l.36-2.57c.66-.27 1.29-.64 1.87-1.08l2.42.98a.5.5 0 0 0 .6-.22l1.95-3.37a.5.5 0 0 0-.12-.64l-2.06-1.6c.05-.35.08-.7.08-1.08Z',
      'M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z',
    ],
  },
  shuffle: { d: ['M4 7H18L15 4', 'M20 17H6L9 20'] },
  stats: { d: ['M5 19V10', 'M12 19V5', 'M19 19V13'] },
  trash: {
    d: ['M9 4h6l1 2h4v2H4V6h4l1-2z', 'M6 9h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9z', 'M10 11v7M14 11v7'],
  },

  // --- Shapes previously hand-inlined in pages ------------------------------
  heart: { d: HEART },
  'heart-filled': { d: HEART, filled: true },
  edit: { d: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z'] },
  refresh: { d: 'M20 12a8 8 0 0 1-13.66 5.66M4 12a8 8 0 0 1 13.66-5.66M4 4v4h4M20 20v-4h-4' },
  loader: { d: 'M12 4a8 8 0 1 1-7.32 11.2' },
  'smart-mix': {
    d: [
      'M5 16.5V14m4 4.5v-9m4 6.5V6m4 10.5V11',
      'm17.6 4 .45 1.15L19.2 5.6l-1.15.45-.45 1.15-.45-1.15L16 5.6l1.15-.45L17.6 4Z',
    ],
  },
  'playlist-add': { d: ['M5 7h9M5 11h9M5 15h6', 'M17.5 12.5v6m-3-3h6'] },

  // --- Generic UI icons -------------------------------------------------------
  close: { d: ['M18 6 6 18', 'm6 6 12 12'] },
  info: { d: [CIRCLE_9, 'M12 16v-4', dot(12, 8)] },
  'chevron-down': { d: 'm6 9 6 6 6-6' },
  'chevron-up': { d: 'm18 15-6-6-6 6' },
  'chevron-left': { d: 'm15 18-6-6 6-6' },
  'chevron-right': { d: 'm9 18 6-6-6-6' },
  check: { d: 'M20 6 9 17l-5-5' },
  volume: { d: [SPEAKER, 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'] },
  'volume-low': { d: [SPEAKER, 'M15.5 8.5a5 5 0 0 1 0 7'] },
  'volume-off': { d: [SPEAKER, 'm22 9-6 6', 'm16 9 6 6'] },
  more: { d: [dot(5, 12), dot(12, 12), dot(19, 12)] },
  clock: { d: [CIRCLE_9, 'M12 7v5l3 2'] },
  eq: { d: ['M5 20V4', 'M12 20V4', 'M19 20V4', 'M3 14h4', 'M10 8h4', 'M17 16h4'] },
  folder: { d: 'M4 6a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z' },
  'external-link': { d: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'] },
  minus: { d: 'M6 12h12' },
  plus: { d: ['M12 6v12', 'M6 12h12'] },
  drag: { d: [dot(9, 6), dot(15, 6), dot(9, 12), dot(15, 12), dot(9, 18), dot(15, 18)] },
  warning: {
    d: ['M10.3 4.2 2.4 17.6a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z', 'M12 9v4', dot(12, 17)],
  },
  download: { d: ['M12 4v11', 'm7 10 5 5 5-5', 'M4 19h16'] },
  sleep: { d: [MOON, 'M17 3h3l-3 3h3'] },
  speed: { d: ['M5 18a9 9 0 1 1 14 0', 'm12 12.3 4-4', dot(12, 12.3)] },
  game: {
    d: [
      'M6 8h12a4 4 0 0 1 4 4v3a3 3 0 0 1-5.4 1.8L15 15H9l-1.6 1.8A3 3 0 0 1 2 15v-3a4 4 0 0 1 4-4Z',
      'M6.5 12h4',
      'M8.5 10v4',
      dot(16, 11),
      dot(18, 13.5),
    ],
  },
  overlay: { d: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z', 'M12 12h6v4h-6z'] },
  sparkle: {
    d: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z', 'm19 16 .7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7L19 16Z'],
  },
  list: { d: ['M8 6h13', 'M8 12h13', 'M8 18h13', dot(3.5, 6), dot(3.5, 12), dot(3.5, 18)] },
  grid: { d: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'] },
  'arrow-up': { d: ['M12 19V5', 'm5 12 7-7 7 7'] },
  'arrow-down': { d: ['M12 5v14', 'm19 12-7 7-7-7'] },
  'x-circle': { d: [CIRCLE_9, 'm15 9-6 6', 'm9 9 6 6'] },
  moon: { d: MOON },
  sun: {
    d: [
      'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
      'M12 2v2',
      'M12 20v2',
      'm4.93 4.93 1.41 1.41',
      'm17.66 17.66 1.41 1.41',
      'M2 12h2',
      'M20 12h2',
      'm6.34 17.66-1.41 1.41',
      'm19.07 4.93-1.41 1.41',
    ],
  },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

/** Every icon name, in declaration order (for tests and the UI kit). */
export const ICON_NAMES = Object.keys(ICONS) as readonly IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Pixel size; default 16. */
  size?: 12 | 14 | 16 | 18 | 20 | 24 | 28 | 32;
  /** Stroke width on the 24 grid; default 1.8. */
  strokeWidth?: number;
  /** Accessible label; when omitted the icon is aria-hidden. */
  label?: string;
}

export const Icon: FC<IconProps> = ({ name, size = 16, strokeWidth = 1.8, label, className, ...rest }) => {
  const icon: IconDef = ICONS[name];
  const paths = Array.isArray(icon.d) ? icon.d : [icon.d];
  const pathProps = icon.filled ? { fill: 'currentColor', stroke: 'none' } : undefined;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      className={clsx('shrink-0', className)}
      {...rest}
    >
      {paths.map((d, index) => (
        <path key={index} d={d} {...pathProps} />
      ))}
    </svg>
  );
};

export default Icon;
