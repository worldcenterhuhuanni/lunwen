// 手绘线性图标(统一 1.5 描边 / 圆角端点),避免 emoji,也不额外引入图标库依赖。
import type { SVGProps } from 'react';

function Svg({ size = 18, children, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconSettings = (p: { size?: number }) => (
  <Svg {...p}>
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
    <circle cx="10" cy="7" r="2.2" />
    <circle cx="15" cy="12" r="2.2" />
    <circle cx="8" cy="17" r="2.2" />
  </Svg>
);

export const IconPage = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="17" x2="13" y2="17" />
  </Svg>
);

export const IconLink = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M9 12h6" />
    <path d="M10 8H7a4 4 0 0 0 0 8h3" />
    <path d="M14 8h3a4 4 0 0 1 0 8h-3" />
  </Svg>
);

export const IconSend = (p: { size?: number }) => (
  <Svg {...p}>
    <line x1="12" y1="19" x2="12" y2="5" />
    <path d="M6 11l6-6 6 6" />
  </Svg>
);

export const IconStop = (p: { size?: number }) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </Svg>
);

export const IconDownload = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M12 4v10" />
    <path d="M8 11l4 4 4-4" />
    <path d="M5 19h14" />
  </Svg>
);

export const IconUpload = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M12 20V10" />
    <path d="M8 13l4-4 4 4" />
    <path d="M5 5h14" />
  </Svg>
);

export const IconExpand = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M8 3H3v5" />
    <path d="M16 3h5v5" />
    <path d="M8 21H3v-5" />
    <path d="M16 21h5v-5" />
    <path d="M3 8l6-6" />
    <path d="M21 8l-6-6" />
    <path d="M3 16l6 6" />
    <path d="M21 16l-6 6" />
  </Svg>
);

export const IconClose = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </Svg>
);

export const IconChevron = (p: { size?: number }) => (
  <Svg {...p}>
    <path d="M7 10l5 5 5-5" />
  </Svg>
);
