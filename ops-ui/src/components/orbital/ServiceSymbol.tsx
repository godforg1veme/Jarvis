import { InterfaceIcon, type InterfaceIconName } from './InterfaceIcon';

const symbols: Record<string, InterfaceIconName> = { postgres: 'server', cloudflared: 'cloud', 'telegram-parser': 'send', 'jarvis-server': 'device' };
export function ServiceSymbol({ serviceKey }: { serviceKey: string }) {
  return <span className="service-symbol" aria-hidden="true"><InterfaceIcon name={symbols[serviceKey] ?? 'orbit'} /></span>;
}
