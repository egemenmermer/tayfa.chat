import type { Catalog } from '@rooms/i18n';

/** English for the Studio group. Keys are the Turkish source text exactly as written in the code. */
export const studio: Catalog = {
  Piyano: 'Piano',
  'Davul seti': 'Drum kit',
  Bas: 'Bass',
  'Lead synth': 'Lead synth',
  'Pad synth': 'Pad synth',
  'Ses kaydı': 'Audio recording',
  'Bilinmeyen enstrüman': 'Unknown instrument',
  'Bu enstrüman için Tayfa’yı güncelle': 'Update Tayfa to play this instrument',
  'Ses kayıtları bu sürümde henüz çalınmıyor': 'Audio recordings don’t play in this version yet',
  Kick: 'Kick',
  Trampet: 'Snare',
  'El çırpma': 'Clap',
  Rim: 'Rim',
  'Kapalı hi-hat': 'Closed hi-hat',
  'Açık hi-hat': 'Open hi-hat',
  'Alçak tom': 'Low tom',
  'Yüksek tom': 'High tom',
  'Dışa aktarılacak aralık boş.': 'The export range is empty.',
  'Dışa aktarma en fazla 10 dakika olabilir.': 'An export can be at most 10 minutes long.',
  // Editors (arrangement, piano roll, drum steps).
  'Stüdyo düzenleyicileri': 'Studio editors',
  Izgara: 'Grid',
  'Izgaraya yasla': 'Snap to grid',
  Serbest: 'Off',
  Uzaklaştır: 'Zoom out',
  Yakınlaştır: 'Zoom in',
  'Notaları uzaklaştır': 'Zoom notes out',
  'Notaları yakınlaştır': 'Zoom notes in',
  'Salt okunur': 'Read-only',
  'Bu projede düzenleme iznin yok; yalnızca dinleyebilirsin.':
    'You can’t edit this project; you can only listen.',
  'Bu projede düzenleme iznin yok; klipleri açıp inceleyebilirsin.':
    'You can’t edit this project; you can still open and inspect clips.',
  'Düzenleme zaman çizelgesi': 'Arrangement timeline',
  'Zaman çizelgesi': 'Timeline',
  'Henüz parça yok. Parça ekledikten sonra çift tıklayarak klip oluşturabilirsin.':
    'No tracks yet. Add a track, then double-click to create a clip.',
  'Klip bu tür bir parçaya taşınamaz': 'The clip can’t move to that kind of track',
  'Ses parçalarına kayıt yakında geliyor; şimdilik klip oluşturulamaz':
    'Recording on audio tracks is coming soon; clips can’t be created there yet',
  'Düzenlemek için bir klip seç': 'Select a clip to edit',
  'Bir parçada boş yere çift tıkla veya sürükle: yeni klip oluşur.':
    'Double-click or drag in an empty spot on a track to create a clip.',
  Düzenleyici: 'Editor',
  Adımlar: 'Steps',
  'Piyano rulosu': 'Piano roll',
  'Adım modu': 'Step mode',
  Vuruş: 'Hits',
  Vurgu: 'Accent',
  'Vuruş gücü': 'Velocity',
  'Tıkla veya sürükle: adım ekle/sil · Shift+tık: vurgu':
    'Click or drag: add/remove steps · Shift+click: accent',
  'Çift tık: nota ekle/sil · Sürükle: taşı · Alt+sürükle: kopyala':
    'Double-click: add/remove note · Drag: move · Alt+drag: copy',
  'Davul adımları': 'Drum steps',
  '{row}, adım {step}': '{row}, step {step}',
  'Bu nota kitin satırlarında yok': 'This note has no row in the kit',
  'kit dışı': 'not in kit',
  'Döngü ve çalma konumu üstteki çalma çubuğundan ayarlanır':
    'Set the loop and play position in the transport bar above',
};
