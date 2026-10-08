// Small hand-drawn icon set (24px grid, 1.8 stroke). Kept inline instead of an icon library so the admin
// bundle stays tiny.

const PATHS = {
  home: "M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10M10 19.5v-5h4v5",
  orders: "M7 4h10a2 2 0 0 1 2 2v14l-3-1.8L13 20l-3-1.8L7 20V6a2 2 0 0 1 0-2zM9.5 9h5M9.5 13h5",
  box: "M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5zM3.5 7.5 12 12l8.5-4.5M12 12v9",
  tag: "M3.5 12.2V5a1.5 1.5 0 0 1 1.5-1.5h7.2l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.6 6.6a1.5 1.5 0 0 1-2.1 0zM8 8h.01",
  bolt: "M13 3 5 13.5h6L10 21l8-10.5h-6z",
  image: "M4 5h16v14H4zM4 16l4.5-4.5L13 16l3-3 4 4M9 9.5h.01",
  menu: "M4 7h16M4 12h16M4 17h16",
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  pin: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  folder: "M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.2h8A1.5 1.5 0 0 1 20.5 8.7V18A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z",
  truck: "M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3.2v2.8h-7M7 18.2a1.7 1.7 0 1 0 0-.01M17 18.2a1.7 1.7 0 1 0 0-.01",
  settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19.4 13.5a7.7 7.7 0 0 0 0-3l1.8-1.4-1.8-3.1-2.1.8a7.5 7.5 0 0 0-2.6-1.5L14.3 3h-3.6l-.4 2.3a7.5 7.5 0 0 0-2.6 1.5l-2.1-.8-1.8 3.1L5.6 10.5a7.7 7.7 0 0 0 0 3l-1.8 1.4 1.8 3.1 2.1-.8a7.5 7.5 0 0 0 2.6 1.5l.4 2.3h3.6l.4-2.3a7.5 7.5 0 0 0 2.6-1.5l2.1.8 1.8-3.1z",
  refund: "M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5M12 8v4.2l2.6 1.6",
  chart: "M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6M20 16v-9",
  users: "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zM3 19.5c.4-3 2.8-4.7 6-4.7s5.6 1.7 6 4.7M16.5 5.2a3.2 3.2 0 0 1 0 6M18.5 15c1.6.6 2.6 2 2.9 4.5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.8-3.8",
  bell: "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8M12 16.8h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.8h.01",
  alert: "M12 3.5 2.8 19.5h18.4zM12 10v4.5M12 17.2h.01",
  check: "M4.5 12.5 9.5 17.5 19.5 6.5",
  checkCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.2l2.8 2.8L16 9.5",
  x: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  upload: "M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v4.5h16V15",
  download: "M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5M4 15v4.5h16V15",
  sun: "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z",
  chevron: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  phone: "M6.5 4h3l1.5 4-2 1.3a10 10 0 0 0 5.7 5.7L16 13l4 1.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z",
  whatsapp: "M4 20l1.2-4.1A8.5 8.5 0 1 1 8.2 19zM9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 .8a4.5 4.5 0 0 1-2-2l.8-1-1-2z",
  print: "M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M7 14h10v6H7z",
  trash: "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5",
  edit: "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17zM14 8l3 3",
  copy: "M8 8h11v12H8zM5 16V4h11",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.7a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4z",
  laptop: "M5 6h14v9H5zM2.5 18.5h19",
  sheet: "M5 3.5h10l4 4V20.5H5zM15 3.5v4h4M8.5 12h7M8.5 15.5h7M8.5 8.5h3",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  logout: "M10 4.5H5.5v15H10M15 8l4 4-4 4M19 12H9.5",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  mail: "M3.5 6h17v12h-17zM3.5 7l8.5 6.5L20.5 7",
  panel: "M4 5h16v14H4zM9.5 5v14M6.8 9.2h.01M6.8 12h.01M6.8 14.8h.01",
  send: "M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z",
  camera: "M4 8h3l1.5-2.5h7L17 8h3v11H4zM12 16.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}
