import Svg, { Circle, Path, Rect } from 'react-native-svg';

type P = { size?: number; color?: string; strokeWidth?: number };

const base = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none' as const });

export const HomeIcon = ({ size = 23, color = '#fff', strokeWidth = 2 }: P) => (
  <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round">
    <Path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
  </Svg>
);
export const CompassIcon = ({ size = 23, color = '#fff', strokeWidth = 2 }: P) => (
  <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round">
    <Circle cx="12" cy="12" r="9" />
    <Path d="m15.5 8.5-2 5-5 2 2-5z" />
  </Svg>
);
export const BookmarkIcon = ({ size = 23, color = '#fff', strokeWidth = 2 }: P) => (
  <Svg {...base(size)} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round">
    <Path d="M6 3h12v18l-6-4.5L6 21z" />
  </Svg>
);
export const FilterIcon = ({ size = 20, color = '#fff' }: P) => (
  <Svg {...base(size)} stroke={color} strokeWidth={2} strokeLinecap="round">
    <Path d="M4 6h16M7 12h10M10 18h4" />
  </Svg>
);
export const SearchIcon = ({ size = 18, color = '#fff' }: P) => (
  <Svg {...base(size)} stroke={color} strokeWidth={2.2} strokeLinecap="round">
    <Circle cx="11" cy="11" r="6.5" />
    <Path d="m16 16 4.5 4.5" />
  </Svg>
);
export const UserIcon = ({ size = 20, color = '#fff' }: P) => (
  <Svg {...base(size)} stroke={color} strokeWidth={2} strokeLinecap="round">
    <Circle cx="12" cy="8" r="4" />
    <Path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </Svg>
);
export const CheckIcon = ({ size = 15, color = '#fff' }: P) => (
  <Svg {...base(size)} stroke={color} strokeWidth={2.4} strokeLinecap="round">
    <Path d="m5 12 5 5 9-10" />
  </Svg>
);
export const EyeOffIcon = ({ size = 15, color = '#fff' }: P) => (
  <Svg {...base(size)} stroke={color} strokeWidth={2} strokeLinecap="round">
    <Path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.6 6.6C4.4 8 2.8 10 2 12c1 2.5 5 7 10 7 1.8 0 3.4-.6 4.8-1.4" />
    <Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Svg>
);
export const PlusIcon = ({ size = 15, color = '#fff' }: P) => (
  <Svg {...base(size)} stroke={color} strokeWidth={2.4} strokeLinecap="round">
    <Path d="M12 5v14M5 12h14" />
  </Svg>
);
export const BanIcon = ({ size = 15, color = '#fff' }: P) => (
  <Svg {...base(size)} stroke={color} strokeWidth={2.2} strokeLinecap="round">
    <Circle cx="12" cy="12" r="8.5" />
    <Path d="m6 6 12 12" />
  </Svg>
);
export const DownloadIcon = ({ size = 15, color = '#fff' }: P) => (
  <Svg {...base(size)} stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />
  </Svg>
);
export const ExternalIcon = ({ size = 15, color = '#fff' }: P) => (
  <Svg {...base(size)} stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
);
export const DriveIcon = ({ size = 14, color = '#fff' }: P) => (
  <Svg {...base(size)} stroke={color} strokeWidth={2}>
    <Rect x="3" y="13" width="18" height="7" rx="2" />
    <Path d="M5 13 7.5 5h9L19 13" />
    <Circle cx="16.5" cy="16.5" r="1" fill={color} />
  </Svg>
);
export const ScreenIcon = ({ size = 15, color = '#fff' }: P) => (
  <Svg {...base(size)} stroke={color} strokeWidth={2}>
    <Rect x="3" y="5" width="18" height="12" rx="2" />
    <Path d="M8 21h8" />
  </Svg>
);
export const CloseIcon = ({ size = 10, color = '#fff' }: P) => (
  <Svg {...base(size)} stroke={color} strokeWidth={3.5}>
    <Path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

/** Metacritic mark: a black disc with a white ring and "M", in the style of their logo. */
export const MetacriticIcon = ({ size = 18 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx="12" cy="12" r="11" fill="#000" stroke="#ffcc34" strokeWidth={1.6} />
    <Path d="M6.5 16.5V8.2l3 4.6 2.5-4.6 2.5 4.6 3-4.6v8.3" fill="none" stroke="#fff" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
  </Svg>
);
/** Google's four-colour "G", used only on the Google sign-in and link buttons (per Google's branding rules). */
export const GoogleIcon = ({ size = 18 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 48 48">
    <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </Svg>
);

export const StarIcon = ({ size = 24, color = '#fff', filled = false }: { size?: number; color?: string; filled?: boolean }) => (
  <Svg {...{ width: size, height: size, viewBox: '0 0 24 24' }} fill={filled ? color : 'none'} stroke={color} strokeWidth={1.8} strokeLinejoin="round">
    <Path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
  </Svg>
);
