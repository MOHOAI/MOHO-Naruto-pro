import '../styles.css';
import {
  auth,
  initAuth,
  googleSignIn,
  googleSignOut,
  getAccessToken,
  saveProgressToFirestore,
  loadProgressFromFirestore,
  saveScheduleToFirestore,
  getSchedulesFromFirestore,
  deleteScheduleFromFirestore,
  updateScheduleStatusInFirestore,
  type WatchScheduleItem
} from './firebase.ts';
import {
  getOrCreateAnimeTaskList,
  createWatchTask,
  completeTask,
  deleteTask,
  type GoogleTaskList
} from './googleTasks.ts';

const BASE_SERVER = 'https://server.sanime.net/Video2/512/';
const episodeUrl = (number) => `${BASE_SERVER}${number}.mp4`;
const ARC_NAMES = [
  'آرك إنقاذ الكازيكاغي غارا',
  'آرك استعادة ساسكي ولمّ الشمل',
  'آرك نينجا الحراس الاثني عشر',
  'آرك هيدان وكاكوزو',
  'آرك ظهور ذي الذيول الثلاثة',
  'آرك مطاردة إيتاتشي',
  'آرك قصة جيرايا الشجاع',
  'آرك هجوم باين',
  'آرك قمة الكاجي الخمسة',
  'آرك الحرب العظمى الرابعة'
];

export const episodeData = Array.from({ length: 500 }, (_, index) => {
  const n = index + 1;
  const season = Math.min(10, Math.ceil(n / 50));
  const filler = [
    54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,89,90,91,92,93,94,95,96,97,98,99,
    100,101,102,103,104,105,106,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,
    151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,
    173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,
    195,196,197,198,199,200,201,202,203,204,205,230,231,232,233,234,235,236,237,238,239,240,
    241,242,243,244,245,246,247,248,249,250,251,252,253,254,255,256,257,258,259,260,261,262,
    263,264,265,266,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,282,283,284,
    285,286,287,288,289,290,291,292,303,304,305,306,307,308,309,310,311,312,313,314,315,316,
    317,318,319,320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,338,
    339,340,341,342,343,344,345,346,347,348,349,350,351,352,353,354,355,356,357,358,359,360,
    361,362,363,364,365,366,367,368,369,370,371,372,373,374,375,376,377,378,379,380,381,382,
    383,384,385,386,387,388,389,390,391,392,393,394,395,396,397,398,399,400,401,402,403,404,
    405,406,407,408,409,410,411,412,413,414,415,416,417,418,419,420,421,422,423,424,425,426,
    427,428,429,430,431,432,433,434,435,436,437,438,439,440,441,442,443,444,445,446,447,448,
    449,450,451,452,453,454,455,456,457,458,459,460,461,462,463,464,465,466,467,468,469,470,
    471,472,473,474,475,476,477,478,479,480,481,482,483,484,485,486,487,488,489,490,491,492,
    493,494,495,496,497,498,499,500
  ].includes(n);
  return {
    n,
    season,
    type: filler ? 'filler' : 'canon',
    arc: ARC_NAMES[Math.min(ARC_NAMES.length - 1, Math.floor((n - 1) / 52))]
  };
});

// Local progress fallback
const getProgress = () => {
  try {
    return JSON.parse(localStorage.getItem('moho_progress')) || { current: 8, time: 0, watched: [] };
  } catch {
    return { current: 8, time: 0, watched: [] };
  }
};
const saveProgressLocal = (data) => {
  try {
    localStorage.setItem('moho_progress', JSON.stringify(data));
  } catch {}
};

let userProgress = getProgress();
let currentUser = null;
let currentGoogleToken = null;
let userSchedules: WatchScheduleItem[] = [];
let animeTaskList: GoogleTaskList | null = null;
let syncDebounceTimer = null;

const state = {
  season: 'all',
  type: 'all',
  search: '',
  limit: 24,
  current: userProgress.current
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

export const toast = (message: string) => {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  window.clearTimeout((toast as any).timer);
  (toast as any).timer = window.setTimeout(() => el.classList.remove('show'), 2800);
};

// Debounced Cloud Sync
function queueCloudSync() {
  saveProgressLocal(userProgress);
  updateCloudBadge(false);
  if (!currentUser) return;
  window.clearTimeout(syncDebounceTimer);
  syncDebounceTimer = window.setTimeout(async () => {
    try {
      await saveProgressToFirestore(currentUser.uid, userProgress);
      updateCloudBadge(true);
    } catch (err) {
      console.error('Failed to sync progress to Firestore:', err);
    }
  }, 1200);
}

function updateCloudBadge(isSynced: boolean) {
  const badge = $('#cloudSyncBadge');
  if (!badge) return;
  if (!currentUser) {
    badge.innerHTML = `<span class="material-symbols-rounded" style="font-size:13px">cloud_off</span> حفظ محلي`;
    badge.className = 'cloud-sync-badge pending';
    badge.title = 'سجل دخولك لحفظ التقدم سحابياً عبر الأجهزة';
  } else if (isSynced) {
    badge.innerHTML = `<span class="material-symbols-rounded" style="font-size:13px">cloud_done</span> متزامن سحابياً`;
    badge.className = 'cloud-sync-badge';
    badge.title = 'تمت مزامنة تقدم المشاهدة مع فايربيس';
  } else {
    badge.innerHTML = `<span class="material-symbols-rounded spin" style="font-size:13px">sync</span> جاري المزامنة...`;
    badge.className = 'cloud-sync-badge pending';
  }
}

function markWatched(episodeNum: number) {
  if (!userProgress.watched.includes(episodeNum)) {
    userProgress.watched.push(episodeNum);
    queueCloudSync();
    renderEpisodes();
  }
}

function getFilteredEpisodes() {
  const query = state.search.trim().toLowerCase();
  return episodeData.filter((episode) => {
    const matchesSeason = state.season === 'all' || episode.season === Number(state.season);
    const matchesType = state.type === 'all' || episode.type === state.type;
    const matchesSearch = !query || String(episode.n).includes(query) || episode.arc.toLowerCase().includes(query);
    return matchesSeason && matchesType && matchesSearch;
  });
}

function renderSeasonTabs() {
  const tabsContainer = $('#seasonTabs');
  if (!tabsContainer) return;
  const tabs = [{ id: 'all', label: 'الكل' }, ...Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1), label: `م${i + 1}` }))];
  tabsContainer.innerHTML = tabs
    .map(
      (tab) =>
        `<button class="season-tab ${String(state.season) === tab.id ? 'active' : ''}" data-season="${tab.id}">${tab.label}</button>`
    )
    .join('');
  $$('.season-tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      state.season = tab.dataset.season;
      state.limit = 24;
      render();
    })
  );
}

function episodeCard(episode) {
  const active = episode.n === state.current;
  const isWatched = userProgress.watched.includes(episode.n);
  const typeLabel = episode.type === 'canon' ? 'مانغا' : 'فلر';
  return `<article class="episode-card ${active ? 'active' : ''} ${isWatched ? 'watched' : ''}" data-episode="${episode.n}" tabindex="0" aria-label="الحلقة ${episode.n}">
    <div class="ep-top"><span class="ep-num">${String(episode.n).padStart(2, '0')}</span><span class="ep-type ${episode.type}">${typeLabel}</span></div>
    <div class="ep-title">${episode.arc}</div>
    <div class="ep-bottom"><span>23 دقيقة</span><span class="ep-play">${isWatched ? '✓' : (active ? '●' : '▶')}</span></div>
  </article>`;
}

function renderEpisodes() {
  const grid = $('#episodesGrid');
  if (!grid) return;
  const filtered = getFilteredEpisodes();
  const visible = filtered.slice(0, state.limit);
  grid.innerHTML = visible.length ? visible.map(episodeCard).join('') : `<div class="empty-state">لا توجد نتائج بهذا البحث. جرّب رقمًا آخر أو أعد التصفية.</div>`;
  const countEl = $('#episodesCount');
  if (countEl) countEl.textContent = `عرض ${visible.length} من ${filtered.length} حلقة`;
  const titleEl = $('#episodesTitle');
  if (titleEl) titleEl.textContent = state.search ? `نتائج البحث: ${state.search}` : state.season === 'all' ? 'كل الحلقات' : `الموسم ${state.season}`;
  const loadMoreBtn = $('#loadMore');
  if (loadMoreBtn) loadMoreBtn.style.display = visible.length < filtered.length ? 'block' : 'none';
  $$('.episode-card').forEach((card) => {
    card.addEventListener('click', () => selectEpisode(Number(card.dataset.episode)));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') selectEpisode(Number(card.dataset.episode));
    });
  });
}

function render() {
  renderSeasonTabs();
  renderEpisodes();
}

export function selectEpisode(number: number) {
  const episode = episodeData[number - 1];
  if (!episode) return;
  state.current = number;
  userProgress.current = number;
  userProgress.time = 0;
  queueCloudSync();

  const nowPlayingTitle = $('#nowPlayingTitle');
  if (nowPlayingTitle) nowPlayingTitle.innerHTML = `الحلقة ${number} <span>— ${episode.arc}</span>`;
  const nowPlayingMeta = $('#nowPlayingMeta');
  if (nowPlayingMeta) nowPlayingMeta.textContent = `الموسم ${episode.season} · ${episode.type === 'canon' ? 'قصة المانغا' : 'فلر'} · 23 دقيقة`;

  const directUrl = episodeUrl(number);
  const singleDownload = $('#singleDownload');
  if (singleDownload) {
    singleDownload.href = directUrl;
    singleDownload.download = `moho-shippuden-${String(number).padStart(3, '0')}.mp4`;
  }
  const player = $('#videoPlayer') as HTMLVideoElement;
  if (player) {
    player.pause();
    const source = $('#videoSource') as HTMLSourceElement;
    if (source) source.src = directUrl;
    player.load();
    player.currentTime = 0;
  }
  renderEpisodes();
  updateNextPrev();
  updateContinueCard();
  const playerCard = document.querySelector('#playerCard');
  if (playerCard) playerCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast(`تم اختيار الحلقة ${number}`);
}

function updateNextPrev() {
  const nextBtn = $('#nextEpisodeBtn') as HTMLButtonElement;
  const prevBtn = $('#prevEpisodeBtn') as HTMLButtonElement;
  if (nextBtn) {
    nextBtn.disabled = state.current >= 500;
    nextBtn.onclick = () => selectEpisode(state.current + 1);
  }
  if (prevBtn) {
    prevBtn.disabled = state.current <= 1;
    prevBtn.onclick = () => selectEpisode(state.current - 1);
  }
}

function updateContinueCard() {
  const card = document.querySelector('.continue-card');
  if (!card) return;
  const ep = episodeData[userProgress.current - 1];
  if (!ep) return;
  const artSpan = card.querySelector('.continue-art span');
  if (artSpan) artSpan.textContent = String(ep.n).padStart(2, '0');
  const copyStrong = card.querySelector('.continue-copy strong');
  if (copyStrong) copyStrong.textContent = ep.arc;
  const mins = Math.floor(userProgress.time / 60);
  const secs = Math.floor(userProgress.time % 60);
  const copySpan = card.querySelector('.continue-copy span');
  if (copySpan) copySpan.textContent = `توقفت عند ${mins}:${String(secs).padStart(2, '0')} من 23:00`;
  const duration = 23 * 60;
  const pct = Math.min(100, (userProgress.time / duration) * 100);
  const progressBar = card.querySelector('.mini-progress i') as HTMLElement;
  if (progressBar) progressBar.style.width = `${pct}%`;
  const btn = $('#continueButton');
  if (btn) btn.onclick = () => selectEpisode(userProgress.current);
}

// Auth UI rendering
function renderAuthUI() {
  const container = $('#authContainer');
  if (!container) return;

  if (currentUser) {
    const avatar = currentUser.photoURL
      ? `<img class="user-avatar" src="${currentUser.photoURL}" alt="${currentUser.displayName || 'مستخدم'}" />`
      : `<div class="user-avatar-placeholder">${(currentUser.displayName || 'M')[0].toUpperCase()}</div>`;

    container.innerHTML = `
      <div class="user-chip-container">
        <button type="button" class="user-chip" id="userMenuToggle" aria-label="قائمة الحساب">
          ${avatar}
          <span class="user-name">${currentUser.displayName ? currentUser.displayName.split(' ')[0] : 'حسابي'}</span>
          <span class="material-symbols-rounded" style="font-size:14px;color:var(--muted)">arrow_drop_down</span>
        </button>
        <div class="user-menu-dropdown" id="userMenuDropdown">
          <div class="user-menu-header">
            <div class="user-menu-name">${currentUser.displayName || 'المستخدم'}</div>
            <div class="user-menu-email">${currentUser.email || ''}</div>
            <div class="user-menu-sync"><span class="material-symbols-rounded" style="font-size:13px">cloud_done</span> المزامنة السحابية نشطة</div>
          </div>
          <button type="button" class="user-menu-item" id="openSchedulesBtn">
            <span class="material-symbols-rounded">calendar_month</span>
            <span>جدول المواعيد والتذكيرات</span>
            <span class="sched-badge tasks" style="margin-right:auto">${userSchedules.length}</span>
          </button>
          <button type="button" class="user-menu-item" id="openNewScheduleFromMenu">
            <span class="material-symbols-rounded">add_task</span>
            <span>جدولة تذكير حلقة جديدة</span>
          </button>
          <button type="button" class="user-menu-item danger" id="signOutBtn">
            <span class="material-symbols-rounded">logout</span>
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </div>
    `;

    $('#userMenuToggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      $('#userMenuDropdown')?.classList.toggle('show');
    });

    $('#signOutBtn')?.addEventListener('click', async () => {
      try {
        await googleSignOut();
        toast('تم تسجيل الخروج بنجاح');
      } catch (err) {
        toast('تعذر تسجيل الخروج');
      }
    });

    $('#openSchedulesBtn')?.addEventListener('click', () => {
      $('#userMenuDropdown')?.classList.remove('show');
      openSchedulesModal();
    });

    $('#openNewScheduleFromMenu')?.addEventListener('click', () => {
      $('#userMenuDropdown')?.classList.remove('show');
      openNewScheduleModal(state.current);
    });
  } else {
    // Official Google Sign-in button
    container.innerHTML = `
      <button class="gsi-material-button" id="googleLoginBtn" type="button" aria-label="تسجيل الدخول باستخدام حساب Google">
        <div class="gsi-icon">
          <svg viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
          </svg>
        </div>
        <span>تسجيل الدخول</span>
      </button>
    `;

    $('#googleLoginBtn')?.addEventListener('click', async () => {
      try {
        toast('جاري تسجيل الدخول بجوجل...');
        await googleSignIn();
      } catch (err: any) {
        console.error('Sign-in error:', err);
        toast(err.message || 'فشل تسجيل الدخول بجوجل');
      }
    });
  }
}

// Watch Schedule & Google Tasks Modals
function openNewScheduleModal(episodeNumber = state.current) {
  if (!currentUser) {
    toast('يرجى تسجيل الدخول أولاً لجدولة التذكيرات ومزامنتها');
    $('#googleLoginBtn')?.click();
    return;
  }

  const ep = episodeData[episodeNumber - 1];
  const modal = $('#scheduleModal');
  if (!modal) return;

  const defaultDateTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
  defaultDateTime.setMinutes(0);
  const tzOffset = defaultDateTime.getTimezoneOffset() * 60000;
  const localISOTime = new Date(defaultDateTime.getTime() - tzOffset).toISOString().slice(0, 16);

  modal.innerHTML = `
    <div class="modal-window">
      <div class="modal-header">
        <div class="modal-title-group">
          <h3>جدولة موعد وتذكير للمشاهدة</h3>
          <span>احجز وقتًا لمشاهدة الحلقة مع مزامنة فورية في Google Tasks</span>
        </div>
        <button class="modal-close-btn" id="closeScheduleModalBtn">✕</button>
      </div>

      <form id="scheduleForm">
        <div class="form-group">
          <label>الحلقة المختارة</label>
          <select id="schedEpisodeNum">
            ${episodeData.slice(0, 500).map(e => `
              <option value="${e.n}" ${e.n === episodeNumber ? 'selected' : ''}>
                حلقة ${e.n} — ${e.arc} (${e.type === 'canon' ? 'مانغا' : 'فلر'})
              </option>
            `).join('')}
          </select>
        </div>

        <div class="form-group">
          <label>موعد المشاهدة والتذكير</label>
          <input type="datetime-local" id="schedDatetime" value="${localISOTime}" required />
        </div>

        <div class="form-group">
          <label>ملاحظات إضافية (اختياري)</label>
          <textarea id="schedNotes" placeholder="مثلاً: مشاهدة مع أصدقاء النينجا، أو متابعة بعد الإفطار"></textarea>
        </div>

        <label class="form-checkbox-row">
          <input type="checkbox" id="syncGoogleTasksCheck" checked />
          <div>
            <strong>المزامنة في Google Tasks</strong>
            <small>إنشاء تذكير تلقائي في قائمة "موهو — جدول المشاهدة" داخل حسابك بجوجل</small>
          </div>
        </label>

        <div style="display:flex;gap:10px;margin-top:20px">
          <button type="submit" class="button button-primary full-button" id="saveScheduleBtn" style="flex:1">
            <span class="material-symbols-rounded">event_available</span>
            <span>تأكيد وجدولة التذكير</span>
          </button>
          <button type="button" class="button button-ghost" id="cancelScheduleBtn" style="padding:0 18px">إلغاء</button>
        </div>
      </form>
    </div>
  `;

  modal.classList.add('show');

  $('#closeScheduleModalBtn')?.addEventListener('click', () => modal.classList.remove('show'));
  $('#cancelScheduleBtn')?.addEventListener('click', () => modal.classList.remove('show'));

  $('#scheduleForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const epNum = Number(($('#schedEpisodeNum') as HTMLSelectElement).value);
    const chosenEp = episodeData[epNum - 1];
    const schedDate = ($('#schedDatetime') as HTMLInputElement).value;
    const notes = ($('#schedNotes') as HTMLTextAreaElement).value.trim();
    const syncTasks = ($('#syncGoogleTasksCheck') as HTMLInputElement).checked;

    const submitBtn = $('#saveScheduleBtn') as HTMLButtonElement;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="material-symbols-rounded spin">sync</span> <span>جاري الحفظ والمزامنة...</span>`;

    let googleTaskId = '';
    if (syncTasks && currentGoogleToken) {
      try {
        if (!animeTaskList) {
          animeTaskList = await getOrCreateAnimeTaskList(currentGoogleToken);
        }
        const createdTask = await createWatchTask(currentGoogleToken, animeTaskList.id, {
          episodeNumber: epNum,
          episodeTitle: chosenEp.arc,
          scheduledDate: schedDate,
          notes
        });
        googleTaskId = createdTask.id;
      } catch (err: any) {
        console.error('Google Tasks creation error:', err);
        toast('تم الحفظ في موهو، وتأخرت مزامنة Google Tasks');
      }
    }

    try {
      const newSchedule = await saveScheduleToFirestore(currentUser.uid, {
        id: `sched_${Date.now()}`,
        episodeNumber: epNum,
        episodeTitle: chosenEp.arc,
        scheduledFor: schedDate,
        googleTaskId,
        status: 'pending',
        notes
      });
      userSchedules.push(newSchedule);
      userSchedules.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
      modal.classList.remove('show');
      renderScheduleSidebarCard();
      renderAuthUI();
      toast(`تمت جدولة الحلقة ${epNum} بنجاح! 📅`);
    } catch (err: any) {
      console.error('Save schedule error:', err);
      toast('تعذر حفظ الموعد في السحابة');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function openSchedulesModal() {
  const modal = $('#scheduleModal');
  if (!modal) return;

  const itemsHtml = userSchedules.length
    ? userSchedules.map((item) => {
        const d = new Date(item.scheduledFor);
        const formattedDate = !isNaN(d.getTime())
          ? d.toLocaleDateString('ar-EG', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          : item.scheduledFor;
        const isDone = item.status === 'completed';

        return `
          <div class="schedule-item-card ${isDone ? 'completed' : ''}" data-sched-id="${item.id}">
            <div class="sched-info">
              <strong>حلقة ${item.episodeNumber} — ${item.episodeTitle}</strong>
              <span>📅 ${formattedDate}</span>
              ${item.notes ? `<span style="color:var(--soft);font-size:9px">💬 ${item.notes}</span>` : ''}
              <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
                <span class="sched-badge ${isDone ? 'done' : 'tasks'}">
                  ${isDone ? '✓ تمت المشاهدة' : '⏰ موعد منتظر'}
                </span>
                ${item.googleTaskId ? '<span class="sched-badge tasks">متزامن مع Google Tasks</span>' : ''}
              </div>
            </div>
            <div class="sched-actions">
              <button class="sched-btn-icon watch" title="مشاهدة هذه الحلقة الآن" data-action="watch" data-ep="${item.episodeNumber}">
                <span class="material-symbols-rounded">play_arrow</span>
              </button>
              ${!isDone ? `
                <button class="sched-btn-icon" title="تحديد كمكتمل" data-action="complete" data-id="${item.id}">
                  <span class="material-symbols-rounded">check</span>
                </button>
              ` : ''}
              <button class="sched-btn-icon delete" title="حذف هذا الموعد" data-action="delete" data-id="${item.id}">
                <span class="material-symbols-rounded">delete</span>
              </button>
            </div>
          </div>
        `;
      }).join('')
    : `<div class="empty-state" style="padding:28px 14px">لا توجد مواعيد مجدولة حاليًا.<br>اضغط "جدولة حلقة جديدة" لبدء تنظيم وقتك!</div>`;

  modal.innerHTML = `
    <div class="modal-window">
      <div class="modal-header">
        <div class="modal-title-group">
          <h3>جدول المشاهدة والتذكيرات</h3>
          <span>قائمة المواعيد المحفوظة في حسابك والمتزامنة مع Google Tasks</span>
        </div>
        <button class="modal-close-btn" id="closeScheduleModalBtn">✕</button>
      </div>

      <div class="schedule-list">
        ${itemsHtml}
      </div>

      <div style="display:flex;gap:10px;margin-top:14px">
        <button type="button" class="button button-primary full-button" id="addNewSchedBtn" style="flex:1">
          <span class="material-symbols-rounded">add</span>
          <span>جدولة حلقة جديدة</span>
        </button>
        <button type="button" class="button button-ghost" id="closeSchedModalBottom">إغلاق</button>
      </div>
    </div>
  `;

  modal.classList.add('show');
  $('#closeScheduleModalBtn')?.addEventListener('click', () => modal.classList.remove('show'));
  $('#closeSchedModalBottom')?.addEventListener('click', () => modal.classList.remove('show'));
  $('#addNewSchedBtn')?.addEventListener('click', () => {
    openNewScheduleModal(state.current);
  });

  // Action clicks inside list
  modal.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const action = (btn as HTMLElement).dataset.action;
      const id = (btn as HTMLElement).dataset.id;
      const epNum = Number((btn as HTMLElement).dataset.ep);

      if (action === 'watch') {
        modal.classList.remove('show');
        selectEpisode(epNum);
      } else if (action === 'complete') {
        const item = userSchedules.find((s) => s.id === id);
        if (!item) return;
        try {
          await updateScheduleStatusInFirestore(currentUser.uid, id, 'completed');
          item.status = 'completed';
          if (item.googleTaskId && currentGoogleToken && animeTaskList) {
            await completeTask(currentGoogleToken, animeTaskList.id, item.googleTaskId).catch(console.error);
          }
          openSchedulesModal();
          renderScheduleSidebarCard();
          toast('تم تحديث حالة الموعد إلى مكتمل ✓');
        } catch (err) {
          toast('تعذر تحديث الموعد');
        }
      } else if (action === 'delete') {
        const item = userSchedules.find((s) => s.id === id);
        if (!item) return;
        // User Confirmation Dialog (MANDATORY for Workspace Operations)
        promptDestructiveConfirm(
          `هل أنت متأكد من حذف تذكير مشاهدة الحلقة ${item.episodeNumber}؟`,
          `سيتم حذف الموعد نهائيًا من حسابك في موهو ومن تطبيق Google Tasks إذا كان متزامنًا.`,
          async () => {
            try {
              await deleteScheduleFromFirestore(currentUser.uid, id);
              if (item.googleTaskId && currentGoogleToken && animeTaskList) {
                await deleteTask(currentGoogleToken, animeTaskList.id, item.googleTaskId).catch(console.error);
              }
              userSchedules = userSchedules.filter((s) => s.id !== id);
              openSchedulesModal();
              renderScheduleSidebarCard();
              renderAuthUI();
              toast('تم حذف التذكير بنجاح');
            } catch (err) {
              toast('تعذر حذف التذكير');
            }
          }
        );
      }
    });
  });
}

// Confirmation Dialog for Workspace Destructive operations
function promptDestructiveConfirm(title: string, message: string, onConfirm: () => void) {
  const confirmContainer = $('#confirmModal');
  if (!confirmContainer) {
    if (window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }

  confirmContainer.innerHTML = `
    <div class="confirm-box">
      <h4>${title}</h4>
      <p>${message}</p>
      <div class="confirm-actions">
        <button type="button" class="btn-danger" id="confirmDangerBtn">نعم، تأكيد الحذف</button>
        <button type="button" class="button button-ghost button-small" id="cancelDangerBtn">إلغاء</button>
      </div>
    </div>
  `;
  confirmContainer.classList.add('show');

  $('#confirmDangerBtn')?.addEventListener('click', () => {
    confirmContainer.classList.remove('show');
    onConfirm();
  });
  $('#cancelDangerBtn')?.addEventListener('click', () => {
    confirmContainer.classList.remove('show');
  });
}

function renderScheduleSidebarCard() {
  const container = $('#scheduleSidebarCard');
  if (!container) return;

  const nextPending = userSchedules.find((s) => s.status === 'pending');
  if (nextPending) {
    const d = new Date(nextPending.scheduledFor);
    const dateFormatted = !isNaN(d.getTime())
      ? d.toLocaleDateString('ar-EG', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : nextPending.scheduledFor;

    container.innerHTML = `
      <div class="side-card-head">
        <div>
          <span class="section-kicker">تذكيرات المشاهدة</span>
          <h3>الموعد القادم</h3>
        </div>
        <span class="sched-badge tasks">Google Tasks</span>
      </div>
      <p style="margin:10px 0 6px;color:var(--text);font-size:12px;font-weight:700">
        حلقة ${nextPending.episodeNumber}: ${nextPending.episodeTitle}
      </p>
      <p style="color:var(--orange-2);font-size:11px;margin:0 0 14px">
        ⏰ ${dateFormatted}
      </p>
      <div style="display:flex;gap:8px">
        <button class="button button-primary button-small" style="flex:1" id="watchScheduledEpBtn" data-ep="${nextPending.episodeNumber}">
          مشاهدة الآن ▶
        </button>
        <button class="button button-ghost button-small" id="viewAllSchedulesBtn">
          كل المواعيد (${userSchedules.length})
        </button>
      </div>
    `;

    $('#watchScheduledEpBtn')?.addEventListener('click', (e) => {
      const ep = Number((e.currentTarget as HTMLElement).dataset.ep);
      selectEpisode(ep);
    });
    $('#viewAllSchedulesBtn')?.addEventListener('click', () => openSchedulesModal());
  } else {
    container.innerHTML = `
      <div class="side-card-head">
        <div>
          <span class="section-kicker">تذكيرات المشاهدة</span>
          <h3>Google Tasks</h3>
        </div>
        <span class="tiny-live"><i style="background:var(--cyan)"></i> نشط</span>
      </div>
      <p style="margin:12px 0 16px;color:var(--muted);font-size:11px;line-height:1.7">
        احجز موعدًا لمشاهدة الحلقة القادمة مع إشعار تذكير عبر Google Tasks على هاتفك وحاسوبك.
      </p>
      <button class="button button-outline full-button" id="quickScheduleBtn">
        <span class="material-symbols-rounded" style="font-size:16px">event_upcoming</span>
        <span>جدولة تذكير لحلقة اليوم</span>
      </button>
    `;

    $('#quickScheduleBtn')?.addEventListener('click', () => openNewScheduleModal(state.current));
  }
}

// Global dismiss for user dropdown
document.addEventListener('click', (e) => {
  const dropdown = $('#userMenuDropdown');
  if (dropdown && !dropdown.contains(e.target as Node) && !$('#userMenuToggle')?.contains(e.target as Node)) {
    dropdown.classList.remove('show');
  }
});

// Video player events
const playerEl = $('#videoPlayer') as HTMLVideoElement;
if (playerEl) {
  $('#videoOverlay')?.addEventListener('click', () => playerEl.play());
  playerEl.addEventListener('play', () => $('#videoOverlay')?.classList.add('hidden'));
  playerEl.addEventListener('pause', () => $('#videoOverlay')?.classList.remove('hidden'));
  playerEl.addEventListener('loadedmetadata', () => {
    if (userProgress.time > 0 && userProgress.current === state.current) {
      playerEl.currentTime = userProgress.time;
    }
  });
  playerEl.addEventListener('timeupdate', () => {
    userProgress.time = playerEl.currentTime;
    queueCloudSync();
    if (playerEl.duration && playerEl.currentTime > playerEl.duration * 0.9) {
      markWatched(state.current);
    }
    updateContinueCard();
  });
  playerEl.addEventListener('ended', () => {
    if (state.current < 500) selectEpisode(state.current + 1);
  });
}

// Search & Filters
$('#searchInput')?.addEventListener('input', (event: any) => {
  state.search = event.target.value;
  state.limit = 24;
  renderEpisodes();
});
$$('.filter-button').forEach((button) =>
  button.addEventListener('click', () => {
    state.type = (button as HTMLElement).dataset.type;
    $$('.filter-button').forEach((item) => item.classList.toggle('active', item === button));
    state.limit = 24;
    renderEpisodes();
  })
);
$('#loadMore')?.addEventListener('click', () => {
  state.limit += 24;
  renderEpisodes();
});
$('#resetFilters')?.addEventListener('click', () => {
  state.season = 'all';
  state.type = 'all';
  state.search = '';
  state.limit = 24;
  const input = $('#searchInput') as HTMLInputElement;
  if (input) input.value = '';
  $$('.filter-button').forEach((item) =>
    item.classList.toggle('active', (item as HTMLElement).dataset.type === 'all')
  );
  render();
});
$('#fullscreenButton')?.addEventListener('click', () => {
  const frame = $('#videoFrame');
  if (document.fullscreenElement) document.exitFullscreen();
  else frame?.requestFullscreen?.();
});

// Open schedule button in player toolbar
$('#scheduleEpisodeBtn')?.addEventListener('click', () => {
  openNewScheduleModal(state.current);
});

$('#startWatching')?.addEventListener('click', () => {
  window.location.href = './episodes.html';
});
$('#continueButton')?.addEventListener('click', () => selectEpisode(userProgress.current));
$$('[data-scroll="watch"]').forEach((button) =>
  button.addEventListener('click', () => {
    const watchSection = document.querySelector('#watch');
    if (watchSection) watchSection.scrollIntoView({ behavior: 'smooth' });
    else window.location.href = './episodes.html#watch';
  })
);
$$('[data-unavailable]').forEach((button) =>
  button.addEventListener('click', () =>
    toast(`${(button as HTMLElement).dataset.unavailable} غير متاح حاليًا — سنخبرك عند توفره`)
  )
);
$('#themeHint')?.addEventListener('click', () =>
  toast('موهو في وضع العرض الداكن مع دعم فايربيس وGoogle Tasks')
);
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    const input = $('#searchInput') as HTMLInputElement;
    if (input) {
      event.preventDefault();
      input.focus();
    }
  }
});

// App Startup: Listen to Firebase Auth
initAuth(
  async (user, token) => {
    currentUser = user;
    currentGoogleToken = token;
    renderAuthUI();
    toast(`مرحباً بك، ${user.displayName || 'متابع موهو'}`);

    // Load progress from Firestore
    try {
      const cloudProgress = await loadProgressFromFirestore(user.uid);
      if (cloudProgress) {
        userProgress = cloudProgress;
        state.current = userProgress.current;
        saveProgressLocal(userProgress);
        render();
        updateNextPrev();
        updateContinueCard();
        updateCloudBadge(true);
      } else {
        // Upload initial progress
        await saveProgressToFirestore(user.uid, userProgress);
        updateCloudBadge(true);
      }
    } catch (err) {
      console.warn('Initial cloud progress fetch error:', err);
    }

    // Load schedules from Firestore
    try {
      userSchedules = await getSchedulesFromFirestore(user.uid);
      renderScheduleSidebarCard();
      renderAuthUI();
    } catch (err) {
      console.warn('Initial schedules fetch error:', err);
    }

    // Try Google Tasks list pre-fetch if token exists
    if (currentGoogleToken) {
      getOrCreateAnimeTaskList(currentGoogleToken)
        .then((l) => {
          animeTaskList = l;
        })
        .catch(console.error);
    }
  },
  () => {
    currentUser = null;
    currentGoogleToken = null;
    renderAuthUI();
    updateCloudBadge(false);
    renderScheduleSidebarCard();
  }
);

render();
updateNextPrev();
updateContinueCard();
renderAuthUI();
renderScheduleSidebarCard();
updateCloudBadge(false);
