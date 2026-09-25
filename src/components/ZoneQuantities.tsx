import type { ZoneQuantity } from '../types';

export function ZoneQuantities({ quantities }: { quantities?: ZoneQuantity[] }) {
  if (!quantities?.length) return null;
  return <div className="rounded border border-slate-700 p-2 space-y-2">
    <h3 className="text-xs font-semibold text-cyan-300">Bóc tách theo vùng hành lang</h3>
    <table className="w-full text-[10px] text-left">
      <thead className="text-slate-400"><tr><th>Vùng / phương</th><th className="text-right">Sàn m²</th><th className="text-right">Cuộn mới m</th><th className="text-right">Tận dụng m²</th></tr></thead>
      <tbody>{quantities.map(q => <tr key={q.zoneId} className="border-t border-slate-800">
        <td className="py-2">{q.roomName ? `${q.roomName} · ` : ''}{q.name}<span className="block text-slate-400">{q.direction === 'horizontal' ? 'Ngang →' : 'Dọc ↑'}</span></td>
        <td className="text-right font-mono">{q.floorAreaM2.toFixed(2)}</td>
        <td className="text-right font-mono text-emerald-300">{q.linearMeters.toFixed(2)}</td>
        <td className="text-right font-mono text-purple-300">{q.reusedAreaM2.toFixed(2)}<span className="block text-slate-400">{q.reusedPieces} mảnh</span></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
