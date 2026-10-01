/*
 * store.js — estado e persistência local (localStorage + exportação JSON).
 * Os dados nunca saem do navegador, a não ser que o usuário exporte o arquivo.
 */
(function (root) {
  'use strict';
  const KEY = 'mapaOrganizacional.v1';

  const empty = () => ({
    version: 1,
    settings: { companyName: '', focalId: null, formalTieStrength: 2 },
    departments: [],
    people: [],
    relations: [],
    incidents: [],
  });

  const uid = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const listeners = [];
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
    return {
      ...base,
      ...d,
      settings: { ...base.settings, ...(d.settings || {}) },
      departments: d.departments || [],
      people: d.people || [],
      relations: d.relations || [],
      incidents: d.incidents || [],
    };
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Falha ao salvar dados locais', e);
    }
    listeners.forEach((fn) => fn(data));
  }

  const Store = {
    get data() {
      return data;
    },
    onChange(fn) {
      listeners.push(fn);
    },
    replace(newData) {
      data = migrate(JSON.parse(JSON.stringify(newData)));
      save();
    },
    reset() {
      data = empty();
      save();
    },
    setSettings(patch) {
      data.settings = { ...data.settings, ...patch };
      save();
    },
    upsert(collection, item, prefix) {
      const list = data[collection];
      if (!item.id) item.id = uid(prefix || collection[0]);
      const i = list.findIndex((x) => x.id === item.id);
      if (i >= 0) list[i] = { ...list[i], ...item };
      else list.push(item);
      save();
      return item;
    },
    addMany(collection, items, prefix) {
      for (const item of items) {
        if (!item.id) item.id = uid(prefix || collection[0]);
        data[collection].push(item);
      }
      save();
    },
    remove(collection, id) {
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
      if (collection === 'departments') {
        data.people.forEach((p) => p.departmentId === id && (p.departmentId = null));
      }
      save();
    },
    exportJSON() {
      return JSON.stringify(data, null, 2);
    },
  };

  root.Store = Store;
})(typeof self !== 'undefined' ? self : this);
