import React from 'react';
import type { CorridorZone, RoomGeometry } from '../types';
import { EnterInputNumber } from './SidebarLeft';

export function CorridorEditor({ rooms, zones, onChange, selectedId, onSelect, detecting, onReset }: {
  rooms: RoomGeometry[]; zones: CorridorZone[]; onChange: (zones: CorridorZone[]) => void;
  selectedId: string | null; onSelect: (id: string) => void;
  detecting?: boolean; onReset: () => void;
}) {
  const visible = zones.filter(z => rooms.some(r => r.id === z.roomId));
  const selected = visible.find(z => z.id === selectedId) ?? visible[0];
  const update = (zone: CorridorZone) => onChange(zones.map(z => z.id === zone.id ? zone : z));
  const move = (zone: CorridorZone, step: number) => {
    const inRoom = zones.filter(z => z.roomId === zone.roomId);
    const index = inRoom.findIndex(z => z.id === zone.id);
    const neighbor = inRoom[index + step];
    if (!neighbor) return;
    const next = [...zones];
    const a = next.findIndex(z => z.id === zone.id), b = next.findIndex(z => z.id === neighbor.id);
    [next[a], next[b]] = [next[b], next[a]];
    onChange(next);
  };
  const fieldClass = 'w-full mt-1 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-slate-100';
  return <div className="mt-2 space-y-2 border-t border-slate-700 pt-2" aria-label="Chia vùng hành lang">
    <p className="text-[11px] text-cyan-200">Bấm vùng trên bản vẽ hoặc chọn trong danh sách để đổi phương trải.</p>
    <button className="w-full rounded border border-cyan-600 py-1 text-cyan-300 disabled:opacity-40"
      disabled={detecting} onClick={onReset}>{detecting ? 'Đang nhận diện các đoạn…' : 'Nhận diện lại các đoạn'}</button>
    {rooms.map(room => <div key={room.id} className="space-y-1">
      <p className="text-[10px] text-slate-400">{room.name}</p>
      {visible.filter(z => z.roomId === room.id).map((zone, index, list) => <div key={zone.id} className="flex gap-1">
        <button aria-pressed={selected?.id === zone.id} onClick={() => onSelect(zone.id)}
          className={`flex-1 rounded border px-2 py-1 text-left ${selected?.id === zone.id ? 'border-amber-400 bg-amber-500/15 text-amber-200' : 'border-slate-700 text-slate-300'}`}>
          {index + 1}. {zone.name} · {zone.direction === 'horizontal' ? '→ Ngang' : '↑ Dọc'}
        </button>
        <button aria-label={`Ưu tiên ${zone.name} trước`} disabled={index === 0} onClick={() => move(zone, -1)} className="px-2 border border-slate-700 rounded disabled:opacity-25">↑</button>
        <button aria-label={`Ưu tiên ${zone.name} sau`} disabled={index === list.length - 1} onClick={() => move(zone, 1)} className="px-2 border border-slate-700 rounded disabled:opacity-25">↓</button>
      </div>)}
      <button className="text-[10px] text-cyan-300 py-1" onClick={() => {
        const zone: CorridorZone = { id: `${room.id}-ZONE-${crypto.randomUUID()}`, roomId: room.id,
          name: `Vùng bổ sung ${visible.filter(z => z.roomId === room.id).length + 1}`,
          direction: 'horizontal', bounds: { ...room.bbox } };
        onChange([...zones, zone]); onSelect(zone.id);
      }}>+ Thêm vùng cho phần sàn còn lại</button>
    </div>)}
    <p className="text-[10px] text-slate-400">Vùng ở trên trải liên tục qua nút giao. Dùng ↑ ↓ để chọn nhánh đi xuyên; vùng sau dừng ở mép vùng trước.</p>
    {selected && <div className="rounded border border-amber-500/40 p-2 space-y-2">
      <label className="block text-[10px]">Tên vùng
        <input aria-label="Tên vùng" className={fieldClass} value={selected.name}
          onChange={e => update({ ...selected, name: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-1">
        {(['horizontal', 'vertical'] as const).map(direction => <button key={direction}
          onClick={() => update({ ...selected, direction })} aria-pressed={selected.direction === direction}
          className={`rounded border py-1 ${selected.direction === direction ? 'border-blue-400 bg-blue-600 text-white' : 'border-slate-700 text-slate-300'}`}>
          {direction === 'horizontal' ? 'Ngang →' : 'Dọc ↑'}
        </button>)}
      </div>
      <p className="text-[10px] text-slate-400">Giới hạn vùng tính từ góc dưới trái phòng, đơn vị mm. Phần ngoài sàn tự được loại bỏ.</p>
      <div className="grid grid-cols-2 gap-2">
        {(['x', 'y', 'width', 'height'] as const).map(field => {
          const room = rooms.find(r => r.id === selected.roomId)!;
          const b = selected.bounds;
          const value = field === 'x' ? b.minX - room.bbox.minX : field === 'y' ? b.minY - room.bbox.minY : b[field];
          const label = { x: 'Vị trí X', y: 'Vị trí Y', width: 'Rộng theo X', height: 'Cao theo Y' }[field];
          return <label key={field} className="text-[10px]">{label}
            <EnterInputNumber value={Math.round(value * 1000) / 1000} className={fieldClass}
              min={field === 'width' || field === 'height' ? 1 : undefined} onCommit={value => {
                const next = { ...b };
                if (field === 'x') { next.minX = room.bbox.minX + value; next.maxX = next.minX + next.width; }
                if (field === 'y') { next.minY = room.bbox.minY + value; next.maxY = next.minY + next.height; }
                if (field === 'width') { next.width = value; next.maxX = next.minX + value; }
                if (field === 'height') { next.height = value; next.maxY = next.minY + value; }
                update({ ...selected, bounds: next });
              }} />
          </label>;
        })}
      </div>
      <button className="text-[10px] text-rose-300" onClick={() => onChange(zones.filter(z => z.id !== selected.id))}>Xóa vùng đang chọn</button>
    </div>}
    <p className="text-[10px] text-slate-400">Khi nhận diện tự động, các đoạn cùng phương trong một phòng được gộp thành một dải. Phòng sau chỉ nhận mảnh thừa cho dải chính khi mảnh đó phủ trọn chiều dài; nếu thiếu, app đặt dải cuộn mới tại đầu hành lang. Mảnh thừa có thể xoay 90° giữa vùng ngang và dọc. Thứ tự trên cũng là thứ tự thi công.</p>
  </div>;
}
