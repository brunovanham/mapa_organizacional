/*
 * store.js — estado e persistência local (localStorage + exportação JSON).
 * Os dados nunca saem do navegador, a não ser que o usuário exporte o arquivo.
 */
(function (root) {
  'use strict';
  const KEY = 'mapaOrganizacional.v1';
  const uid = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const empty = () => ({
    version: 1,
    settings: { companyName: '', focalId: null, formalTieStrength: 2 },
    departments: [],
    people: [],
    relations: [],
    incidents: [],
    knowledge: [],
  });

  const listeners = [];
  const persistListeners = [];
  let version = 0;
  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return migrate(JSON.parse(raw));
    } catch (e) {
      console.warn('Falha ao ler dados locais', e);
    }
    return empty();
  }

  function migrate(d) {
    const base = empty();
    const out = {
      ...base,
      ...d,
      settings: { ...base.settings, ...(d.settings || {}) },
      departments: d.departments || [],
      people: d.people || [],
      relations: d.relations || [],
      incidents: d.incidents || [],
      knowledge: d.knowledge || [],
    };
    // Versões antigas guardavam conhecimentos como texto livre: cada texto
    // vira um item do catálogo e a pessoa passa a apontar para o item.
    const byId = new Map(out.knowledge.map((k) => [k.id, k]));
    const byName = new Map(out.knowledge.map((k) => [k.name.trim().toLowerCase(), k]));
    for (const p of out.people) {
      p.skills = [
        ...new Set(
          (p.skills || []).map((s) => {
            if (byId.has(s)) return s;
            const key = String(s).trim().toLowerCase();
            if (!key) return null;
            let k = byName.get(key);
            if (!k) {
              const name = String(s).trim();
              k = { id: uid('k'), name: name.charAt(0).toUpperCase() + name.slice(1), category: 'Outros', importance: 2 };
              out.knowledge.push(k);
              byId.set(k.id, k);
              byName.set(key, k);
            }
            return k.id;
          })
        ),
      ].filter(Boolean);
    }
    return out;
  }

  // silent: grava sem notificar a interface (usado na ficha, para não perder o foco).
  // meta.fromRemote: dados vindos do GitHub (não precisam ser reenviados).
  function save(silent, meta) {
    version++;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Falha ao salvar dados locais', e);
    }
    persistListeners.forEach((fn) => fn(data, meta || {}));
    if (!silent) listeners.forEach((fn) => fn(data));
  }

  const Store = {
    get data() {
      return data;
    },
    get version() {
      return version;
    },
    onChange(fn) {
      listeners.push(fn);
    },
    // Chamado em toda gravação, inclusive as silenciosas (usado pelo GitHubSync).
    onPersist(fn) {
      persistListeners.push(fn);
    },
    replace(newData, meta) {
      data = migrate(JSON.parse(JSON.stringify(newData)));
      save(false, meta);
    },
    reset() {
      data = empty();
      save();
    },
    setSettings(patch) {
      data.settings = { ...data.settings, ...patch };
      save();
    },
    upsert(collection, item, prefix, opts) {
      const list = data[collection];
      if (!item.id) item.id = uid(prefix || collection[0]);
      const i = list.findIndex((x) => x.id === item.id);
      if (i >= 0) list[i] = { ...list[i], ...item };
      else list.push(item);
      save(opts && opts.silent);
      return item;
    },
    addMany(collection, items, prefix, opts) {
      for (const item of items) {
        if (!item.id) item.id = uid(prefix || collection[0]);
        data[collection].push(item);
      }
      save(opts && opts.silent);
    },
    remove(collection, id, opts) {
      data[collection] = data[collection].filter((x) => x.id !== id);
      if (collection === 'people') {
        data.relations = data.relations.filter((r) => r.source !== id && r.target !== id);
        data.people.forEach((p) => p.managerId === id && (p.managerId = null));
        data.incidents.forEach((ev) => {
          ev.actors = (ev.actors || []).filter((a) => a !== id);
          ev.targets = (ev.targets || []).filter((a) => a !== id);
        });
        if (data.settings.focalId === id) data.settings.focalId = null;
      }
      if (collection === 'knowledge') {
        data.people.forEach((p) => (p.skills = (p.skills || []).filter((k) => k !== id)));
      }
      if (collection === 'departments') {
        data.people.forEach((p) => p.departmentId === id && (p.departmentId = null));
      }
      save(opts && opts.silent);
    },
    uid,
    exportJSON() {
      return JSON.stringify(data, null, 2);
    },
  };

  root.Store = Store;
})(typeof self !== 'undefined' ? self : this);
