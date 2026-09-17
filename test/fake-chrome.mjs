/* Un faux chrome.* fidele, pour tester la veille sans navigateur.
 *
 * Il ne cherche pas a etre complet : il reproduit exactement les proprietes
 * dont depend la correction du code de veille, et rien d'autre.
 *
 *   storage  un set() est atomique sur toutes ses cles, mais deux sequences
 *            get -> set entrelacees perdent une ecriture. Le faux le reproduit
 *            fidelement, avec une latence artificielle reglable qui rend la
 *            course deterministe au lieu de rare.
 *   alarms   l'horloge est injectee. Une alarme ponctuelle est SUPPRIMEE au
 *            declenchement -- c'est cette propriete, verifiee dans la source de
 *            Chromium, qui fait qu'une veille a alarme unique peut mourir pour
 *            de bon. Une alarme periodique ne rattrape jamais les periodes
 *            manquees : elle se declenche une fois et se recale.
 *
 * Le quota est compte comme Chromium le compte : longueur de la cle plus
 * longueur de la valeur serialisee en JSON.
 */

const QUOTA_LOCAL = 10 * 1024 * 1024;

function awaitVerdict(ms) {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

/* ------------------------------------------------------------------ stockage */

function creerZoneStockage(name, { latenceMs = 0, quota = QUOTA_LOCAL, journal }) {
  const data = new Map();
  const auditeurs = [];

  const copie = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  const taille = () => {
    let n = 0;
    for (const [k, v] of data) n += k.length + JSON.stringify(v).length;
    return n;
  };

  return {
    _donnees: data,
    _taille: taille,
    _auditeurs: auditeurs,

    async get(keys) {
      journal.push({ zone: name, op: 'get', keys });
      await awaitVerdict(latenceMs);
      if (keys === null || keys === undefined) {
        const everything = {};
        for (const [k, v] of data) everything[k] = copie(v);
        return everything;
      }
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (data.has(k)) out[k] = copie(data.get(k));
      return out;
    },

    /** Atomique : toutes les cles de l'objet sont commitees ensemble. */
    async set(obj) {
      journal.push({ zone: name, op: 'set', keys: Object.keys(obj) });
      await awaitVerdict(latenceMs);

      const projection = new Map(data);
      for (const [k, v] of Object.entries(obj)) projection.set(k, copie(v));
      let n = 0;
      for (const [k, v] of projection) n += k.length + JSON.stringify(v).length;
      if (n > quota) {
        const e = new Error(`QUOTA_BYTES quota exceeded (${n} > ${quota})`);
        e.name = 'QuotaExceeded';
        throw e;
      }

      const changements = {};
      for (const [k, v] of Object.entries(obj)) {
        const before = data.get(k);
        data.set(k, copie(v));
        changements[k] = { oldValue: copie(before), newValue: copie(v) };
      }
      for (const a of auditeurs) a(changements, name);
    },

    async remove(keys) {
      journal.push({ zone: name, op: 'remove', keys });
      await awaitVerdict(latenceMs);
      const list = Array.isArray(keys) ? keys : [keys];
      const changements = {};
      for (const k of list) {
        if (!data.has(k)) continue;
        changements[k] = { oldValue: copie(data.get(k)) };
        data.delete(k);
      }
      if (Object.keys(changements).length) for (const a of auditeurs) a(changements, name);
    },

    async clear() {
      data.clear();
    },

    async getBytesInUse() {
      return taille();
    },
  };
}

/* -------------------------------------------------------------------- alarmes */

function creerAlarmes({ horloge, journal }) {
  const alarmNames = new Map();
  const auditeurs = [];

  return {
    _alarmes: alarmNames,

    async create(name, info) {
      journal.push({ op: 'alarms.create', name, info });
      const when = info.when !== undefined
        ? info.when
        : horloge.now + (info.delayInMinutes ?? info.periodInMinutes ?? 0) * 60000;
      alarmNames.set(name, {
        name: name,
        scheduledTime: when,
        periodInMinutes: info.periodInMinutes,
      });
    },

    async get(name) {
      return alarmNames.has(name) ? { ...alarmNames.get(name) } : undefined;
    },

    async getAll() {
      return [...alarmNames.values()].map((a) => ({ ...a }));
    },

    async clear(name) {
      return alarmNames.delete(name);
    },

    async clearAll() {
      const n = alarmNames.size > 0;
      alarmNames.clear();
      return n;
    },

    onAlarm: {
      addListener: (fn) => auditeurs.push(fn),
      _auditeurs: auditeurs,
    },

    /** Declenche tout ce qui est du. Appele par l'horloge. */
    async _declencherDues() {
      const dueList = [...alarmNames.values()]
        .filter((a) => a.scheduledTime <= horloge.now)
        .sort((a, b) => a.scheduledTime - b.scheduledTime);

      for (const a of dueList) {
        if (a.periodInMinutes) {
          // Une alarme periodique ne rattrape PAS les periodes manquees : elle
          // se declenche une fois et se recale sur le prochain creneau.
          const pas = a.periodInMinutes * 60000;
          const manquees = Math.floor((horloge.now - a.scheduledTime) / pas);
          a.scheduledTime += pas * (manquees + 1);
        } else {
          // Une alarme ponctuelle est SUPPRIMEE au declenchement. C'est la
          // propriete qui rend mortelle une veille a alarme unique.
          alarmNames.delete(a.name);
        }
        journal.push({ op: 'alarms.fire', name: a.name, t: horloge.now });
        for (const fn of auditeurs) await fn({ name: a.name, scheduledTime: a.scheduledTime });
      }
      return dueList.length;
    },
  };
}

/* --------------------------------------------------------------------- faux */

/**
 * Construit un faux chrome complet.
 *
 * `latenceMs` insere une attente entre la lecture et l'ecriture du stockage :
 * a zero les courses sont rares et le test passe par chance, a quelques
 * millisecondes elles deviennent systematiques.
 */
export function fakeChrome({ now = Date.UTC(2026, 7, 27, 12, 0, 0), latenceMs = 0 } = {}) {
  const journal = [];
  const notifications = [];
  const badges = [];

  const horloge = {
    now,
    /** Avance le temps et declenche les alarmes echues, dans l'ordre. */
    async avancer(ms) {
      horloge.now += ms;
      return chrome.alarms._declencherDues();
    },
    /** Saut de temps SANS declencher : la machine etait eteinte. */
    dormir(ms) {
      horloge.now += ms;
    },
  };

  const local = creerZoneStockage('local', { latenceMs, journal });
  const session = creerZoneStockage('session', { latenceMs, journal });
  const auditeursChangement = [];

  for (const zone of [local, session]) {
    zone._auditeurs.push((changements, name) => {
      for (const fn of auditeursChangement) fn(changements, name);
    });
  }

  const demarrage = [];
  const installation = [];

  const chrome = {
    storage: {
      local,
      session,
      onChanged: { addListener: (fn) => auditeursChangement.push(fn) },
    },

    notifications: {
      async create(id, options) {
        const ident = id || `notif-${notifications.length}`;
        notifications.push({ id: ident, options, t: horloge.now });
        return ident;
      },
      async clear(id) {
        const i = notifications.findIndex((n) => n.id === id);
        if (i >= 0) notifications.splice(i, 1);
        return i >= 0;
      },
      onClicked: { addListener: () => {} },
      onButtonClicked: { addListener: () => {} },
    },

    action: {
      async setBadgeText({ text }) {
        badges.push({ text, t: horloge.now });
      },
      async setBadgeBackgroundColor() {},
      async getBadgeText() {
        return badges.length ? badges[badges.length - 1].text : '';
      },
    },

    runtime: {
      onStartup: { addListener: (fn) => demarrage.push(fn) },
      onInstalled: { addListener: (fn) => installation.push(fn) },
      onMessage: { addListener: () => {} },
      getManifest: () => ({ version: '2.8.0' }),
      lastError: undefined,
    },

    tabs: {
      async create() { return { id: 1 }; },
      async remove() {},
      onUpdated: { addListener: () => {} },
    },

    alarms: null, // rempli juste apres, il a besoin de l'horloge
  };

  chrome.alarms = creerAlarmes({ horloge, journal });

  return {
    chrome,
    horloge,
    journal,
    notifications,
    badges,
    /** Rejoue runtime.onStartup, comme au demarrage d'un profil. */
    async demarrerProfil() { for (const fn of demarrage) await fn(); },
    /** Rejoue runtime.onInstalled. */
    async installer(reasonText = 'install') { for (const fn of installation) await fn({ reason: reasonText }); },
    /** Ce que le stockage contient reellement, pour inspection. */
    payload(zone = 'local') {
      const m = zone === 'local' ? local._donnees : session._donnees;
      return Object.fromEntries([...m.entries()].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
    },
    tailleStockage(zone = 'local') {
      return zone === 'local' ? local._taille() : session._taille();
    },
  };
}
