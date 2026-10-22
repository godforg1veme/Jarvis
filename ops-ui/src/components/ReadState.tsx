export function ReadState({ loading, failed, hasData, retry, label = 'данные' }: {
  loading: boolean; failed: boolean; hasData: boolean; retry: () => void; label?: string;
}) {
  if (failed) return <div className="read-state is-error" role="alert">
    <div><b>Не удалось обновить {label}</b><span>{hasData ? 'Показаны последние полученные данные.' : 'Состояние пока неизвестно. Попробуйте ещё раз.'}</span></div>
    <button type="button" onClick={retry} disabled={loading}>{loading ? 'Обновление…' : 'Повторить'}</button>
  </div>;
  if (loading) return <p className="read-state is-loading" role="status">{hasData ? 'Обновление данных…' : 'Получаем данные…'}</p>;
  return null;
}
