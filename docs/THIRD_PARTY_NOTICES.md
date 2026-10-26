# Üçüncü taraf bildirimleri ve kaynakları

Özgün Tayfa kodu ve proje görselleri kökteki MIT lisansıyla sunulur. Varsayılan DJ çizimi ve korunan varlıklar [varlık kaydında](ASSETS.md) açıklanır. Topluluk medyası sağlayıcısına aittir; depo yeniden lisanslamaz. Inter fontu SIL OFL 1.1 lisansını korur. Font ve gömülü yerel bileşen bildirimleri korunur. Aşağıdaki hukuki lisans metinleri, değiştirilmeden dağıtılması için özgün dillerindedir; açıklamalar Türkçedir.

Bağımlılıkların kendi lisansları geçerlidir. Tam sürümler için kurulu LICENSE dosyaları ve kilit dosyasına bakın. Derleme, kurulu üretim bağımlılık üstverisi ve LICENSE/NOTICE dosyalarından `dist/THIRD_PARTY_NOTICES.txt` üretip `app.asar` içine koyar. Dağıtım imajları ve resmî komut satırı araçları üst bildirimlerini ayrıca korur.

- Electron / MIT: https://github.com/electron/electron
- React / MIT: https://github.com/facebook/react
- TypeScript / Apache-2.0: https://github.com/microsoft/TypeScript
- LiveKit istemci/sunucu SDK'leri / Apache-2.0: https://github.com/livekit/client-sdk-js ve https://github.com/livekit/server-sdk-js
- hls.js / Apache-2.0: https://github.com/video-dev/hls.js
- xterm.js / MIT: https://github.com/xtermjs/xterm.js
- ws / MIT: https://github.com/websockets/ws
- İsteğe bağlı Linux node-pty / MIT: https://github.com/microsoft/node-pty (yalnız sunucu kiti; dağıtımda kurulu LICENSE korunur).
- tmux / ISC: https://github.com/tmux/tmux (sistem bağımlılığı; üst bildirim korunur).
- Fastify / MIT: https://github.com/fastify/fastify
- PostgreSQL Node sürücüsü / MIT: https://github.com/brianc/node-postgres
- MongoDB Node sürücüsü / Apache-2.0: https://github.com/mongodb/node-mongodb-native
- Lucide / ISC: https://github.com/lucide-icons/lucide
- BoardUI ücretsiz katmanı / MIT: https://github.com/BoardUI/boardui. Tayfa renklerine uyarlanmış kaynak `apps/desktop/src/boardui/` altındadır; telif ve izin metni aynı klasördeki `LICENSE` dosyasındadır. BoardUI Pro ayrı ticari lisanslıdır (https://www.boardui.com/license): kaynağı bu depoda bulunmaz, yalnız özel alt modülden derlenmiş paketle dağıtılır ve paket kaynak haritası içermez.
- Tailwind CSS / MIT: https://github.com/tailwindlabs/tailwindcss (derleme aracı; pakete yalnız üretilen CSS girer).
- React Aria ve React Aria Components / Apache-2.0: https://github.com/adobe/react-spectrum
- tailwind-merge / MIT: https://github.com/dcastil/tailwind-merge
- Remix Icon (`@remixicon/react`) / Remix Icon License 1.0: https://github.com/Remix-Design/RemixIcon. Uygulama içi simge olarak kullanılabilir; simgeler logo veya marka işareti yapılamaz ve tek başına simge paketi olarak dağıtılamaz.
- Playwright / Apache-2.0: https://github.com/microsoft/playwright

Değiştirilmeden kendi sunucunda çalışan Stoat ve resmî kurulum ayarı ayrı AGPL-3.0 bileşenleridir: https://github.com/stoatchat/stoatchat ve https://github.com/stoatchat/self-hosted. Tam imaj/kaynak sürümü için [Stoat rehberine](../infra/stoat/README.md) ve yerel sabitleme kayıtlarına bakın. Karşılık gelen kaynak/lisans bağlantılarını kullanıcıya açık tutun. Yayın öncesi geçerli kaynak dağıtım yükümlülüklerini inceleyin; süreçleri ayırmak tek başına hukuki sonuç değildir.

Eski Spacebar entegrasyonu geri dönüş için kaynak/kanıt olarak tutulur, etkin yeni arka uç değildir: https://github.com/spacebarchat/server (AGPL-3.0).

Uzak çalışan değiştirilmemiş resmî Codex ve Claude Code araçlarını kurar. Kullanım/yetkilendirme koşulları Tayfa'dan bağımsızdır; görevi başlatan kişi kendi uygun sağlayıcı hesabını kullanır. Önbellek yetki malzemesi dağıtılmaz. İsteğe bağlı resmî YouTube oynatıcısı ve ayrı sunucu ses bağdaştırıcıları sağlayıcı şartlarını korur. Sağlayıcı bilgisi, hesap oturumu veya medya akışı paketlenmez. Özellik bulunması sağlayıcı/içerik yeniden dağıtım hakkı vermez.

- Inter / SIL Open Font License 1.1: https://github.com/rsms/inter. Tam lisans fontla ve üretilen bildirimlerle dağıtılır.

## RNNoise prototipinin gömülü bileşenleri

- @sapphi-red/web-noise-suppressor 0.4.1 / MIT: https://github.com/sapphi-red/web-noise-suppressor . Kurulu paket bildirimi mevcut üreticiyle alınır.
- Gömülü RNNoise WebAssembly, Shiguredo rnnoise-wasm / Apache-2.0 kullanır: https://github.com/shiguredo/rnnoise-wasm .
- RNNoise / BSD-3-Clause: https://github.com/xiph/rnnoise .

Aşağıdaki bildirimler ayrı kurulu üretim paketlerinden ziyade RNNoise worklet/Wasm içine gömülü kodu kapsar.

### RNNoise COPYING

```text
Copyright (c) 2017, Mozilla
Copyright (c) 2007-2017, Jean-Marc Valin
Copyright (c) 2005-2017, Xiph.Org Foundation
Copyright (c) 2003-2004, Mark Borgerding

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

- Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.

- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

- Neither the name of the Xiph.Org Foundation nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE FOUNDATION
OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

```

### Shiguredo rnnoise-wasm LICENSE (2022.2.0)

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

```

## Güçlü gürültü bastırmanın gömülü bileşenleri

- @sapphi-red/gtcrn-wasm 0.0.3 / MIT: https://github.com/sapphi-red/gtcrn-wasm
- Gömülü GTCRN modeli / MIT: https://github.com/Xiaobin-Rong/gtcrn
- Gömülü pffft FFT / UCAR/FFTPACK: https://github.com/marton78/pffft

Kurulu paketin MIT lisansı bildirim üreticisiyle alınır. Sabit paket dağıtımından gelen model ve FFT bildirimleri aşağıda aynen korunur. Discord veya Krisp ikilisi, modeli ya da kaynağı paketlenmez.

```text

GTCRN

MIT License

Copyright (c) 2024 Rong Xiaobin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


pffft

Copyright (c) 2020  Dario Mambro ( dario.mambro@gmail.com )
Copyright (c) 2019  Hayati Ayguen ( h_ayguen@web.de )
Copyright (c) 2013  Julien Pommier ( pommier@modartt.com )

Copyright (c) 2004 the University Corporation for Atmospheric
Research ("UCAR"). All rights reserved. Developed by NCAR's
Computational and Information Systems Laboratory, UCAR,
www.cisl.ucar.edu.

Redistribution and use of the Software in source and binary forms,
with or without modification, is permitted provided that the
following conditions are met:

- Neither the names of NCAR's Computational and Information Systems
Laboratory, the University Corporation for Atmospheric Research,
nor the names of its sponsors or contributors may be used to
endorse or promote products derived from this Software without
specific prior written permission.

- Redistributions of source code must retain the above copyright
notices, this list of conditions, and the disclaimer below.

- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions, and the disclaimer below in the
documentation and/or other materials provided with the
distribution.

THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING, BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE CONTRIBUTORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS WITH THE
SOFTWARE.

```
