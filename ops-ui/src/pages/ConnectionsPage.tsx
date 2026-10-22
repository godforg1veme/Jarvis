import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { getConnections, reassignDevice, reassignTelegram } from '../api/client';
import { dateLabel, statusLabels } from '../format';
import type { ConnectionProfile } from '../types';
import { useOperationsRead } from '../hooks/useOperationsRead';
import { PageHeading } from '../components/PageHeading';
import { ReadState } from '../components/ReadState';

type Move = { type: 'telegram' | 'device'; id: string; from: string; label: string };
const pendingKey = (move: Move) => `jarvis-reassignment-pending:${move.type}:${move.id}`;
const pendingMessage = 'Итог прежнего переназначения не подтверждён. Новую команду для этого подключения нельзя отправлять до отдельной проверки владельцем.';
const storageMessage = 'Без локальной записи состояния отправка запрещена. Проверьте доступность хранилища браузера.';
function pendingState(move: Move): 'clear' | 'pending' | 'unavailable' {
  try { return sessionStorage.getItem(pendingKey(move)) === null ? 'clear' : 'pending'; }
  catch { return 'unavailable'; }
}

export function ConnectionsPage({ loader = getConnections, refreshToken = 0 }: { loader?: typeof getConnections; refreshToken?: number }) {
  const connections = useOperationsRead<ConnectionProfile[]>(loader, refreshToken);
  const profiles = connections.data;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const targetSelect = useRef<HTMLSelectElement | null>(null);
  const [move, setMove] = useState<Move | null>(null); const [target, setTarget] = useState(''); const [pairingCode, setPairingCode] = useState('');
  useEffect(() => {
    if (!move) return;
    const root = document.getElementById('root');
    const previousInert = root?.inert ?? false;
    if (root) root.inert = true;
    targetSelect.current?.focus();
    return () => {
      if (root) root.inert = previousInert;
      const origin = opener.current;
      const target = origin?.isConnected && !origin.disabled ? origin : document.getElementById('workspace-content');
      target?.focus({ preventScroll: true });
    };
  }, [move]);
  const openMove = (event: MouseEvent<HTMLButtonElement>, value: Move) => {
    opener.current = event.currentTarget;
    const state = pendingState(value);
    setMove(value); setTarget(''); setPairingCode(''); setPending(state !== 'clear');
    setError(state === 'pending' ? pendingMessage : state === 'unavailable' ? storageMessage : '');
  };
  const closeMove = () => {
    if (inFlight.current) return;
    setMove(null); setPairingCode(''); setError(''); setPending(false);
  };
  const submit = async () => {
    if (!move || !target || inFlight.current || pending || connections.failed || connections.loading) return;
    if (!profiles?.some((profile) => profile.id === target && profile.id !== move.from)) {
      setError('Целевой профиль больше недоступен. Обновите список и выберите профиль снова.');
      return;
    }
    const source = profiles.find((profile) => profile.id === move.from);
    const sourceStillOwns = move.type === 'telegram'
      ? source?.telegram.some((identity) => identity.id === move.id)
      : source?.devices.some((device) => device.id === move.id && device.status !== 'revoked');
    if (!sourceStillOwns) {
      setError('Подключение больше не принадлежит исходному профилю. Обновите список и откройте его снова.');
      return;
    }
    const state = pendingState(move);
    if (state !== 'clear') {
      setPending(true);
      setError(state === 'pending' ? pendingMessage : storageMessage);
      return;
    }
    try { sessionStorage.setItem(pendingKey(move), '1'); }
    catch { setPending(true); setError(storageMessage); return; }
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (move.type === 'telegram') {
        await reassignTelegram(move.id, target);
        setMove(null); connections.retry();
      } else {
        const result = await reassignDevice(move.id, target);
        setPairingCode(result.reassignment.code);
        connections.retry();
      }
      try { sessionStorage.removeItem(pendingKey(move)); } catch { /* A retained marker errs toward blocking another mutation. */ }
      setPending(false);
    } catch { setPending(true); setError(pendingMessage); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <>
    <PageHeading title="Устройства" description="Профили, Telegram и подключения Jarvis" />
    <ReadState {...connections} hasData={profiles !== null} label="подключения" />
    {!profiles ? null : profiles.length === 0 ? <div className="notice">Семейные профили ещё не созданы.</div> : <div className="profile-list">{profiles.map((profile) => <section className="profile" key={profile.id}>
      <div className="profile-head"><div className="avatar">{profile.displayName.slice(0, 1).toUpperCase()}</div><div><small>{profile.role === 'owner' ? 'ВЛАДЕЛЕЦ' : 'УЧАСТНИК'}</small><h2>{profile.displayName}</h2></div><span>{profile.devices.filter((device) => device.status === 'online').length} в сети</span></div>
      <div className="connection-columns">
        <div><h3>Telegram</h3>{profile.telegram.length ? profile.telegram.map((identity) => <div className="connection-row" key={identity.id}><span className="telegram-mark">TG</span><div><b>ID {identity.externalId}</b><small>привязан {dateLabel(identity.connectedAt)}</small></div>{profiles.length > 1 ? <button className="row-action" disabled={connections.failed || connections.loading || busy} onClick={(event) => openMove(event, { type: 'telegram', id: identity.id, from: profile.id, label: `Telegram ${identity.externalId}` })}>Переназначить</button> : null}</div>) : <p className="muted">Не привязан</p>}</div>
        <div><h3>Устройства</h3>{profile.devices.length ? profile.devices.map((device) => <div className="connection-row" key={device.id}><span className="device-mark">{device.kind === 'computer' ? 'PC' : device.kind.toUpperCase()}</span><div><b>{device.name}</b><small>{device.kind} · сигнал {dateLabel(device.lastSeenAt)}</small></div><em className={device.status}><i />{statusLabels[device.status]}</em>{profiles.length > 1 && device.status !== 'revoked' ? <button className="row-action" disabled={connections.failed || connections.loading || busy} onClick={(event) => openMove(event, { type: 'device', id: device.id, from: profile.id, label: device.name })}>Переназначить</button> : null}</div>) : <p className="muted">Нет устройств</p>}</div>
      </div>
    </section>)}</div>}{move ? createPortal(<div className="modal-backdrop"><section className="move-dialog" role="dialog" aria-modal="true" aria-label={`Переназначить ${move.label}`}><small>ПЕРЕНАЗНАЧЕНИЕ ПОДКЛЮЧЕНИЯ</small><h2>{move.label}</h2><p>{move.type === 'device' ? 'Старый токен устройства будет отозван. После операции введи новый код на этом компьютере.' : 'Новые Telegram-сообщения пойдут в выбранный профиль. Старая история не перемещается.'}</p><label>Целевой профиль<select ref={targetSelect} value={target} disabled={busy || Boolean(pairingCode)} onChange={(event) => setTarget(event.target.value)}><option value="">Выбрать…</option>{profiles?.filter((profile) => profile.id !== move.from).map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}</select></label>{error ? <p className="notice error" role="alert">{error}</p> : null}{pairingCode ? <div className="pairing-code"><small>КОД ПОВТОРНОЙ ПРИВЯЗКИ</small><b>{pairingCode}</b></div> : null}<div><button className="secondary" disabled={busy} onClick={closeMove}>Закрыть</button>{!pairingCode ? <button className="danger" disabled={!target || pending || connections.failed || connections.loading || busy} onClick={() => void submit()}>{busy ? 'Выполняется…' : 'Переназначить'}</button> : null}</div></section></div>, document.body) : null}
  </>;
}
