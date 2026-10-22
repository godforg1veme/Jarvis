const paths = {
  system: ['M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z', 'M4 12h16M12 4c-4 4-4 12 0 16 4-4 4-12 0-16Z'],
  server: ['M4 6c0-4 16-4 16 0s-16 4-16 0Z', 'M4 6v6c0 4 16 4 16 0V6M4 12v6c0 4 16 4 16 0v-6'],
  orbit: ['M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z', 'M9 8C-3 15 0 24 15 15S26 0 15 7'],
  device: ['M3 4h18v13H3zM8 21h8M12 17v4'],
  pulse: ['M2 12h4l3-8 4 16 3-12 2 4h4'],
  search: ['M16.5 10a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0ZM15 15l5 5'],
  close: ['m6 6 12 12M6 18 18 6'],
  expand: ['M9 4H4v5M15 20h5v-5M4 4l6 6M20 20l-6-6'],
  collapse: ['M4 9h5V4M20 15h-5v5M4 4l5 5M20 20l-5-5'],
  pause: ['M8 5v14M16 5v14'],
  play: ['m8 5 11 7-11 7Z'],
  arrow: ['M5 12h14m-5-5 5 5-5 5'],
  cloud: ['M7 18h11a4 4 0 0 0 0-8 6 6 0 0 0-11-3 5.5 5.5 0 0 0 0 11Z'],
  send: ['m3 10 18-7-7 18-3-8-8-3ZM11 13 21 3'],
} as const;

export type InterfaceIconName = keyof typeof paths;
export function InterfaceIcon({ name }: { name: InterfaceIconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name].map((d, i) => <path d={d} key={i} />)}</svg>;
}
