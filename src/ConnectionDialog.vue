<script setup lang="ts">
import { shallowRef, computed } from 'vue';
import { stateSetter } from './vueLifecycle';
import { Database, ChevronRight, X, Terminal, LoaderCircle } from '@lucide/vue';
import DialogBoundary from './DialogBoundary.vue';
import { parseSqlServerConnectionString } from './connectionString';
import type { Connection } from './types';
import { uid, errorText } from './App';
defineOptions({
  inheritAttrs: false,
});
const _props = defineProps<{
  initial?: Connection;
  onClose: () => void;
  onSave: (c: Connection, password: string, remember: boolean) => Promise<void>;
  onTest: (c: Connection, password: string) => Promise<void>;
}>();
const initial = computed(() => _props.initial);
const onClose = computed(() => _props.onClose);
const onSave = computed(() => _props.onSave);
const onTest = computed(() => _props.onTest);
const connectionString = shallowRef('');
const setConnectionString = stateSetter(connectionString);
function importConnectionString() {
  const _connectionString = connectionString.value;
  setOk(false);
  try {
    const parsed = parseSqlServerConnectionString(_connectionString);
    setC((prev) => ({
      ...prev,
      ...parsed.connection,
      name:
        prev.name ||
        parsed.connection.database + ' @ ' + parsed.connection.host,
    }));
    setPassword(parsed.password);
    setConnectionString('');
    setOk(true);
    setMessage(
      'Connection details filled in. Review the fields below.' +
        (parsed.ignoredOptions
          ? ' Application, pooling, timeout and other client-only options are not imported; DataGoblin uses its own settings.'
          : ''),
    );
  } catch (error) {
    setMessage(errorText(error));
  }
}
const c = shallowRef<Connection>(
  initial.value ?? {
    id: uid(),
    name: '',
    engine: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    username: 'postgres',
    tls: true,
    trustCertificate: false,
  },
);
const setC = stateSetter(c);
const password = shallowRef(''),
  remember = shallowRef(true),
  busy = shallowRef(false),
  message = shallowRef(''),
  ok = shallowRef(false);
const setPassword = stateSetter(password);
const setRemember = stateSetter(remember);
const setBusy = stateSetter(busy);
const setMessage = stateSetter(message);
const setOk = stateSetter(ok);
const patch = (value: Partial<Connection>) => {
  setC((prev) => ({
    ...prev,
    ...value,
  }));
  setMessage('');
};
async function perform(test: boolean) {
  const _c = c.value;
  const _onTest = onTest.value;
  const _password = password.value;
  const _onSave = onSave.value;
  const _remember = remember.value;
  setBusy(true);
  setMessage('');
  setOk(false);
  try {
    if (
      !_c.name.trim() ||
      !_c.host.trim() ||
      !_c.database.trim() ||
      !_c.username.trim() ||
      !Number.isInteger(_c.port) ||
      _c.port < 1 ||
      _c.port > 65535
    )
      throw new Error(
        'Enter a name, host, database, username, and valid port.',
      );
    if (test) {
      await _onTest(_c, _password);
      setOk(true);
      setMessage('Connection successful. Your goblin is in.');
    } else await _onSave(_c, _password, _remember);
  } catch (e) {
    setMessage(errorText(e));
  } finally {
    setBusy(false);
  }
}
</script>

<template>
  <DialogBoundary @close="onClose" :disabled="busy">
    <div class="overlay">
      <form
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Database connection"
        @submit="
          (e) => {
            e.preventDefault();
            void perform(false);
          }
        "
      >
        <div class="modal-heading">
          <div>
            <div class="eyebrow">MAKE YOURSELF AT HOME</div>
            <h2>{{ initial ? 'Edit connection' : 'Connect a database' }}</h2>
          </div>
          <button
            type="button"
            class="icon-button"
            title="Close connection dialog"
            :disabled="busy"
            @click="onClose"
          >
            <X :size="18"></X>
          </button>
        </div>
        <div class="engine-options">
          <template
            v-for="engine in ['sqlserver', 'postgres'] as const"
            :key="engine"
          >
            <button
              type="button"
              :class="c.engine === engine ? 'chosen' : ''"
              @click="
                () =>
                  patch({
                    engine,
                    port: engine === 'postgres' ? 5432 : 1433,
                    database: engine === 'postgres' ? 'postgres' : 'master',
                    username: engine === 'postgres' ? 'postgres' : 'sa',
                  })
              "
            >
              <Database :size="19"></Database>
              {{ engine === 'postgres' ? 'PostgreSQL' : 'SQL Server' }}
            </button>
          </template>
        </div>
        <details>
          <summary>Paste a SQL Server connection string</summary>
          <label>
            Connection string
            <input
              type="password"
              autocomplete="off"
              :spellcheck="false"
              placeholder="Server=localhost;Database=master;User Id=sa;Password=...;"
              :value="connectionString"
              @input="
                (e) => setConnectionString((e.target as HTMLInputElement).value)
              "
            />
          </label>
          <button
            type="button"
            class="secondary-button"
            :disabled="busy || !connectionString.trim()"
            @click="importConnectionString"
          >
            Fill connection details
          </button>
        </details>
        <label>
          Connection name
          <input
            autofocus
            required
            placeholder="Local development"
            :value="c.name"
            @input="
              (e) =>
                patch({
                  name: (e.target as HTMLInputElement).value,
                })
            "
          />
        </label>
        <div class="form-row">
          <label>
            Host
            <input
              required
              :value="c.host"
              @input="
                (e) =>
                  patch({
                    host: (e.target as HTMLInputElement).value,
                  })
              "
            />
          </label>
          <label class="port">
            Port
            <input
              type="number"
              min="1"
              max="65535"
              required
              :value="c.port"
              @input="
                (e) =>
                  patch({
                    port: Number((e.target as HTMLInputElement).value),
                  })
              "
            />
          </label>
        </div>
        <label>
          Initial database
          <input
            required
            :value="c.database"
            @input="
              (e) =>
                patch({
                  database: (e.target as HTMLInputElement).value,
                })
            "
          />
        </label>
        <div class="form-row">
          <label>
            Username
            <input
              required
              autocomplete="username"
              :value="c.username"
              @input="
                (e) =>
                  patch({
                    username: (e.target as HTMLInputElement).value,
                  })
              "
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autocomplete="current-password"
              :placeholder="initial ? 'Leave blank to keep saved password' : ''"
              :value="password"
              @input="
                (e) => {
                  setPassword((e.target as HTMLInputElement).value);
                  setMessage('');
                }
              "
            />
          </label>
        </div>
        <label class="check">
          <input
            type="checkbox"
            :checked="remember"
            @input="(e) => setRemember((e.target as HTMLInputElement).checked)"
          />
          Remember password in system credential store
        </label>
        <div class="tls-options">
          <label class="check">
            <input
              type="checkbox"
              :checked="c.tls"
              @input="
                (e) =>
                  patch({
                    tls: (e.target as HTMLInputElement).checked,
                  })
              "
            />
            Use TLS encryption
          </label>
          <label class="check">
            <input
              type="checkbox"
              :disabled="!c.tls"
              :checked="c.trustCertificate"
              @input="
                (e) =>
                  patch({
                    trustCertificate: (e.target as HTMLInputElement).checked,
                  })
              "
            />
            Trust self-signed certificate
          </label>
        </div>
        <p class="muted">
          Password authentication. Settings stay on this device.
        </p>
        <template v-if="message">
          <div
            :class="'form-message ' + (ok ? 'success' : 'error')"
            role="status"
          >
            {{ message }}
          </div>
        </template>
        <div class="modal-footer">
          <button
            type="button"
            class="secondary-button"
            :disabled="busy"
            @click="() => void perform(true)"
          >
            <template v-if="busy">
              <LoaderCircle :size="14" class="spin"></LoaderCircle>
            </template>
            <template v-else><Terminal :size="14"></Terminal></template>
            Test connection
          </button>
          <button class="primary-button" :disabled="busy" type="submit">
            {{ initial ? 'Save connection' : 'Add connection' }}
            <ChevronRight :size="14"></ChevronRight>
          </button>
        </div>
      </form>
    </div>
  </DialogBoundary>
</template>
