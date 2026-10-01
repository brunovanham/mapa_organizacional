/*
 * github-sync.js — grava e lê os dados num arquivo JSON dentro de um
 * repositório do GitHub (de preferência PRIVADO), pela API de conteúdo.
 *
 * - Não há banco de dados: o arquivo JSON é a fonte da verdade e cada
 *   gravação vira um commit (histórico completo de versões no GitHub).
 * - Não há tela de login: a chave de acesso é configurada uma vez por
 *   navegador, ou recebida por um "link de acesso" gerado na aba Dados.
 * - O localStorage continua como cache: se a internet cair, as alterações
 *   ficam pendentes e são enviadas na próxima oportunidade.
 *
 * Dois modos:
 *   'github'  — o dono do sistema grava direto no repositório com a própria chave.
 *   'empresa' — qualquer pessoa cria/acessa a sua empresa com um código; os dados
 *               vão CIFRADOS (js/vault.js) para a API (worker/), que grava
 *               empresas/<id>.json no repositório de dados.
 */
(function (root) {
  'use strict';
  const CFG_KEY = 'mapaOrganizacional.github';
  const STATE_KEY = 'mapaOrganizacional.githubState';
  const BACKUP_KEY = 'mapaOrganizacional.backupConflito';
  const API = 'https://api.github.com';
  const AUTOSAVE_MS = 4000;

  // "Lembrar neste computador" usa localStorage; senão, sessionStorage
  // (apagado ao fechar a aba).
  const box = (session) => {
    try {
      return session ? sessionStorage : localStorage;
    } catch (e) {
      return null;
    }
  };
  const readJSON = (k, session) => {
    try {
      return JSON.parse(box(session).getItem(k) || 'null');
    } catch (e) {
      return null;
    }
  };
  const writeJSON = (k, v, session) => {
    try {
      if (v === null) box(session).removeItem(k);
      else box(session).setItem(k, JSON.stringify(v));
    } catch (e) {
      /* armazenamento indisponível: segue só em memória */
    }
  };
  const inSession = !readJSON(CFG_KEY) && !!readJSON(CFG_KEY, true);

  // Base64 com UTF-8 (acentos) nos dois sentidos.
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  function explain(status, body) {
    const msg = (body && body.message) || '';
    if (status === 401) return 'Chave de acesso inválida ou expirada.';
    if (status === 403 && /rate limit/i.test(msg)) return 'Limite de requisições do GitHub atingido. Tente novamente em alguns minutos.';
    if (status === 403) return 'A chave não tem permissão. Ela precisa de "Contents: Read and write" neste repositório.';
    if (status === 404) return 'Repositório não encontrado ou a chave não tem acesso a ele.';
    if (status === 409 || status === 422) return 'conflito';
    return `GitHub respondeu ${status}${msg ? ': ' + msg : ''}`;
  }

  async function api(cfg, method, url, body) {
    let res;
    try {
      res = await fetch(API + url, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + cfg.token,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      const err = new Error('Sem conexão com o GitHub. As alterações ficam guardadas neste navegador e serão enviadas depois.');
      err.offline = true;
      throw err;
    }
    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      /* resposta sem corpo */
    }
    if (!res.ok) {
      const err = new Error(explain(res.status, json));
      err.status = res.status;
      err.conflict = res.status === 409 || (res.status === 422 && /sha/i.test((json && json.message) || ''));
      throw err;
    }
    return json;
  }

  const repoPath = (cfg) => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  const filePath = (cfg) => `${repoPath(cfg)}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}`;
  const refQuery = (cfg) => (cfg.branch ? `?ref=${encodeURIComponent(cfg.branch)}` : '');

  const Remote = {
    repoInfo: (cfg) => api(cfg, 'GET', repoPath(cfg)),
    async read(cfg) {
      let j;
      try {
        j = await api(cfg, 'GET', filePath(cfg) + refQuery(cfg));
      } catch (e) {
        if (e.status === 404) {
          await Remote.repoInfo(cfg); // se o repositório também não existir, propaga o erro
          return { data: null, sha: null };
        }
        throw e;
      }
      let text = j.content ? b64decode(j.content) : '';
      if (!text && j.sha) {
        // Arquivos acima de 1 MB vêm sem conteúdo: busca pelo blob.
        const blob = await api(cfg, 'GET', `${repoPath(cfg)}/git/blobs/${j.sha}`);
        text = b64decode(blob.content);
      }
      return { data: JSON.parse(text), sha: j.sha };
    },
    async head(cfg) {
      try {
        const j = await api(cfg, 'GET', filePath(cfg) + refQuery(cfg));
        return j.sha;
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },
    async write(cfg, data, sha, message) {
      const body = { message, content: b64encode(JSON.stringify(data, null, 1)) };
      if (sha) body.sha = sha;
      if (cfg.branch) body.branch = cfg.branch;
      const j = await api(cfg, 'PUT', filePath(cfg), body);
      return j.content.sha;
    },
  };

  // API das empresas (worker/): dados cifrados com o código de acesso.
  const CompanyRemote = {
    async call(cfg, method, body) {
      let res;
      try {
        res = await fetch(`${cfg.apiUrl.replace(/\/+$/, '')}/api/empresas/${cfg.id}`, {
          method,
          cache: 'no-store',
          headers: body ? { 'Content-Type': 'application/json' } : {},
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        const err = new Error('Sem conexão com o servidor. As alterações ficam guardadas neste navegador e serão enviadas depois.');
        err.offline = true;
        throw err;
      }
      let json = null;
      try {
        json = await res.json();
      } catch (e) {
        /* sem corpo */
      }
      if (res.status === 404 && method === 'GET') return null;
      if (!res.ok) {
        const err = new Error((json && json.erro) || `Servidor respondeu ${res.status}.`);
        err.status = res.status;
        err.conflict = res.status === 409;
        throw err;
      }
      return json;
    },
    async read(cfg) {
      const j = await CompanyRemote.call(cfg, 'GET');
      if (!j) return { data: null, sha: null };
      return { data: await root.Vault.unseal(j.envelope, cfg.keyB64), sha: j.sha };
    },
    async head(cfg) {
      const j = await CompanyRemote.call(cfg, 'GET');
      return j ? j.sha : null;
    },
    async write(cfg, data, sha) {
      const envelope = await root.Vault.seal(data, cfg.keyB64);
      const j = await CompanyRemote.call(cfg, 'PUT', { envelope, sha: sha || null });
      return j.sha;
    },
  };

  // ------------------------------------------------------------ controlador
  /**
   * Sync.init(store, hooks)
   *   hooks.onStatus(status)            — atualiza o indicador na interface
   *   hooks.confirm(msg) => boolean     — perguntas ao usuário (conflitos)
   *   hooks.onRemoteLoaded()            — dados recarregados do GitHub
   */
  const Sync = {
    store: null,
    hooks: {},
    session: inSession,
    cfg: readJSON(CFG_KEY, inSession),
    state: readJSON(STATE_KEY, inSession) || { sha: null, dirty: false, savedAt: null },
    status: 'local',
    error: '',
    busy: false,
    timer: null,

    get connected() {
      const c = this.cfg;
      if (!c) return false;
      if (c.mode === 'empresa') return !!(c.apiUrl && c.id && c.keyB64);
      return !!(c.token && c.owner && c.repo);
    },

    get isCompany() {
      return !!(this.cfg && this.cfg.mode === 'empresa');
    },

    get adapter() {
      return this.isCompany ? CompanyRemote : Remote;
    },

    setCfg(cfg, remember) {
      // Limpa as duas caixas e grava só na escolhida.
      for (const sess of [false, true]) {
        writeJSON(CFG_KEY, null, sess);
        writeJSON(STATE_KEY, null, sess);
      }
      this.session = !remember;
      this.cfg = cfg;
      if (cfg) writeJSON(CFG_KEY, cfg, this.session);
      if (this.store && this.store.useStorage) this.store.useStorage(this.session ? 'session' : 'local');
    },

    historyUrl() {
      if (!this.connected || this.isCompany) return '';
      const c = this.cfg;
      return `https://github.com/${c.owner}/${c.repo}/commits/${c.branch || 'HEAD'}/${c.path}`;
    },

    setStatus(status, error) {
      this.status = status;
      this.error = error || '';
      if (this.hooks.onStatus) this.hooks.onStatus(this);
    },

    saveState(patch) {
      this.state = { ...this.state, ...patch };
      writeJSON(STATE_KEY, this.state, this.session);
    },

    async init(store, hooks) {
      this.store = store;
      this.hooks = hooks || {};
      this.consumeAccessLink();
      store.onPersist((data, meta) => {
        if (!this.connected || (meta && meta.fromRemote)) return;
        this.saveState({ dirty: true });
        this.setStatus('dirty');
        this.schedule();
      });
      window.addEventListener('beforeunload', (e) => {
        if (this.connected && (this.state.dirty || this.busy)) {
          this.push();
          e.preventDefault();
          e.returnValue = '';
        }
      });
      // Ao voltar para a aba, busca alterações feitas por outra pessoa.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.refreshIfChanged();
      });
      if (!this.connected) return this.setStatus('local');
      if (this.state.dirty) return this.push();
      return this.pull();
    },

    // Lê a configuração de um link "#acesso=..." e limpa o endereço.
    consumeAccessLink() {
      const m = /[#&]acesso=([^&]+)/.exec(location.hash);
      if (!m) return;
      try {
        const raw = JSON.parse(b64decode(decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/')));
        const cfg = { owner: raw.o, repo: raw.r, branch: raw.b || '', path: raw.p || 'dados/organizacao.json', token: raw.t };
        if (cfg.owner && cfg.repo && cfg.token) {
          this.setCfg(cfg, true);
          this.saveState({ sha: null, dirty: false });
        }
      } catch (e) {
        console.warn('Link de acesso inválido', e);
      }
      history.replaceState(null, '', location.pathname + location.search);
    },

    accessLink() {
      if (!this.connected || this.isCompany) return '';
      const c = this.cfg;
      const payload = b64encode(JSON.stringify({ o: c.owner, r: c.repo, b: c.branch, p: c.path, t: c.token }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      return `${location.origin}${location.pathname}#acesso=${payload}`;
    },

    /**
     * Conecta este navegador ao repositório. Se o arquivo já existe no
     * GitHub, pergunta se carrega de lá ou se envia os dados locais.
     */
    async connect(cfg) {
      cfg = { owner: cfg.owner.trim(), repo: cfg.repo.trim(), branch: (cfg.branch || '').trim(), path: (cfg.path || 'dados/organizacao.json').trim(), token: cfg.token.trim() };
      const info = await Remote.repoInfo(cfg);
      if (!info.private) {
        const ok = this.hooks.confirm(
          `ATENÇÃO: o repositório ${cfg.owner}/${cfg.repo} é PÚBLICO.\n\nQualquer pessoa na internet poderá ler notas, posicionamentos e vínculos dos colaboradores.\n\nRecomendado: cancelar e usar um repositório PRIVADO só para os dados.\n\nContinuar mesmo assim?`
        );
        if (!ok) throw new Error('Conexão cancelada: use um repositório privado.');
      }
      const remote = await Remote.read(cfg);
      this.setCfg(cfg, true);
      const local = this.store.data;
      if (remote.data) {
        const hasLocal = local.people.length > 0;
        const useRemote = !hasLocal || this.hooks.confirm(
          `Já existem dados no GitHub (${(remote.data.people || []).length} colaboradores).\n\nOK = carregar os dados do GitHub neste navegador.\nCancelar = substituir os dados do GitHub pelos deste navegador (${local.people.length} colaboradores).`
        );
        if (useRemote) {
          this.saveState({ sha: remote.sha, dirty: false, savedAt: new Date().toISOString() });
          this.store.replace(remote.data, { fromRemote: true });
          this.setStatus('saved');
          if (this.hooks.onRemoteLoaded) this.hooks.onRemoteLoaded();
          return 'loaded';
        }
      }
      this.saveState({ sha: remote.sha, dirty: true });
      await this.push();
      return 'created';
    },

    /**
     * Entra numa empresa (ou cria) com o código de acesso.
     * opts: { apiUrl, code, remember, create, initialData }
     */
    async enterCompany(opts) {
      const { id, keyB64 } = await root.Vault.open(opts.code);
      const cfg = { mode: 'empresa', apiUrl: opts.apiUrl, id, keyB64 };
      const remote = await CompanyRemote.read(cfg);
      if (opts.create && remote.data) throw new Error('Já existe uma empresa com este código. Escolha outro código.');
      if (!opts.create && !remote.data)
        throw new Error('Nenhuma empresa encontrada com este código. Confira o código: letras maiúsculas e minúsculas fazem diferença.');
      clearTimeout(this.timer);
      this.setCfg(cfg, !!opts.remember);
      if (opts.create) {
        this.state = { sha: null, dirty: false, savedAt: null };
        this.store.replace(opts.initialData, { fromRemote: true });
        this.saveState({ sha: null, dirty: true });
        await this.push();
        if (this.status === 'error') {
          const msg = this.error;
          this.leave();
          throw new Error(msg);
        }
      } else {
        this.saveState({ sha: remote.sha, dirty: false, savedAt: new Date().toISOString() });
        this.store.replace(remote.data, { fromRemote: true });
        this.setStatus('saved');
      }
      if (this.hooks.onRemoteLoaded) this.hooks.onRemoteLoaded();
    },

    /** Sai da empresa e apaga a cópia local (outra pessoa pode usar o computador). */
    leave(emptyData) {
      this.disconnect();
      if (this.store) this.store.replace(emptyData || {}, { fromRemote: true });
    },

    disconnect() {
      this.setCfg(null, true);
      this.state = { sha: null, dirty: false, savedAt: null };
      clearTimeout(this.timer);
      this.setStatus('local');
    },

    schedule() {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.push(), AUTOSAVE_MS);
    },

    async pull() {
      if (!this.connected) return;
      this.setStatus('loading');
      try {
        const remote = await this.adapter.read(this.cfg);
        if (!remote.data) {
          // Arquivo ainda não existe: cria com os dados locais.
          this.saveState({ sha: null, dirty: true });
          return this.push();
        }
        this.saveState({ sha: remote.sha, dirty: false, savedAt: new Date().toISOString() });
        this.store.replace(remote.data, { fromRemote: true });
        this.setStatus('saved');
        if (this.hooks.onRemoteLoaded) this.hooks.onRemoteLoaded();
      } catch (e) {
        this.setStatus('error', e.message);
      }
    },

    async refreshIfChanged() {
      if (!this.connected || this.busy || this.state.dirty) return;
      try {
        const sha = await this.adapter.head(this.cfg);
        if (sha && sha !== this.state.sha) await this.pull();
      } catch (e) {
        /* silencioso: tenta de novo na próxima vez */
      }
    },

    async push() {
      if (!this.connected) return;
      clearTimeout(this.timer);
      if (this.busy) {
        this.schedule();
        return;
      }
      if (!this.state.dirty) return this.setStatus('saved');
      this.busy = true;
      this.setStatus('saving');
      const data = this.store.data;
      const version = this.store.version;
      const message = `Atualiza dados (${data.people.length} colaboradores, ${data.relations.length} vínculos)`;
      try {
        const sha = await this.adapter.write(this.cfg, data, this.state.sha, message);
        // Só limpa "pendente" se nada mudou durante o envio.
        const changedMeanwhile = this.store.version !== version;
        this.saveState({ sha, dirty: false, savedAt: new Date().toISOString() });
        this.setStatus('saved');
        if (changedMeanwhile) {
          this.saveState({ dirty: true });
          this.schedule();
        }
      } catch (e) {
        if (e.conflict) await this.resolveConflict();
        else this.setStatus('error', e.message);
      } finally {
        this.busy = false;
      }
    },

    // Outra pessoa salvou depois de nós: pergunta qual versão manter.
    async resolveConflict() {
      const remote = await this.adapter.read(this.cfg);
      const keepMine = this.hooks.confirm(
        'Outra pessoa salvou alterações no GitHub enquanto você editava.\n\nOK = manter a SUA versão (substitui a do GitHub; a outra continua no histórico de versões).\nCancelar = carregar a versão do GitHub (a sua fica guardada como backup neste navegador).'
      );
      if (keepMine) {
        this.saveState({ sha: remote.sha, dirty: true });
        this.busy = false;
        return this.push();
      }
      writeJSON(BACKUP_KEY, { at: new Date().toISOString(), data: this.store.data });
      this.saveState({ sha: remote.sha, dirty: false, savedAt: new Date().toISOString() });
      this.store.replace(remote.data || this.store.data, { fromRemote: true });
      this.setStatus('saved');
      if (this.hooks.onRemoteLoaded) this.hooks.onRemoteLoaded();
    },
  };

  root.GitHubSync = Sync;
  root.CompanyRemote = CompanyRemote;
  root.GitHubRemote = Remote;
})(typeof self !== 'undefined' ? self : this);
