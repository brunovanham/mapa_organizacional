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
 */
(function (root) {
  'use strict';
  const CFG_KEY = 'mapaOrganizacional.github';
  const STATE_KEY = 'mapaOrganizacional.githubState';
  const BACKUP_KEY = 'mapaOrganizacional.backupConflito';
  const API = 'https://api.github.com';
  const AUTOSAVE_MS = 4000;

  const readJSON = (k) => {
    try {
      return JSON.parse(localStorage.getItem(k) || 'null');
    } catch (e) {
      return null;
    }
  };
  const writeJSON = (k, v) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      /* armazenamento indisponível: segue só em memória */
    }
  };

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
    cfg: readJSON(CFG_KEY),
    state: readJSON(STATE_KEY) || { sha: null, dirty: false, savedAt: null },
    status: 'local',
    error: '',
    busy: false,
    timer: null,

    get connected() {
      return !!(this.cfg && this.cfg.token && this.cfg.owner && this.cfg.repo);
    },

    historyUrl() {
      if (!this.connected) return '';
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
      writeJSON(STATE_KEY, this.state);
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
          this.cfg = cfg;
          writeJSON(CFG_KEY, cfg);
          this.saveState({ sha: null, dirty: false });
        }
      } catch (e) {
        console.warn('Link de acesso inválido', e);
      }
      history.replaceState(null, '', location.pathname + location.search);
    },

    accessLink() {
      if (!this.connected) return '';
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
      this.cfg = cfg;
      writeJSON(CFG_KEY, cfg);
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

    disconnect() {
      this.cfg = null;
      writeJSON(CFG_KEY, null);
      writeJSON(STATE_KEY, null);
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
        const remote = await Remote.read(this.cfg);
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
        const sha = await Remote.head(this.cfg);
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
        const sha = await Remote.write(this.cfg, data, this.state.sha, message);
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
      const remote = await Remote.read(this.cfg);
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
  root.GitHubRemote = Remote;
})(typeof self !== 'undefined' ? self : this);
