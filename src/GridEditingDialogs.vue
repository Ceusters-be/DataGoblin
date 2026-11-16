<script setup lang="ts">
import { GridEditing } from './useGridEditing';
import { computed, Teleport } from 'vue';
import DialogBoundary from './DialogBoundary.vue';
import SqlPreview from './SqlPreview.vue';
import { formatCellJson } from './cellValue';
defineOptions({
  inheritAttrs: false,
});
const props = defineProps<{
  editing: GridEditing;
}>();
const message = computed(() => props.editing.message);
const cell = computed(() => props.editing.cell);
const preview = computed(() => props.editing.preview);
const busy = computed(() => props.editing.busy);
const data = computed(() => props.editing.data);
const rowOffset = computed(() => props.editing.rowOffset);
const cellError = computed(() => props.editing.cellError);
const engine = computed(() => props.editing.engine);
const submitted = computed(() => props.editing.submitted);
const onMove = computed(() => props.editing.onMove);
const close = props.editing.close;
const stage = props.editing.stage;
const setCell = props.editing.setCell;
const setCellError = props.editing.setCellError;
const apply = props.editing.apply;
</script>

<template>
  <template v-if="message">
    <div class="grid-edit-message" role="status">{{ message }}</div>
  </template>
  <template v-if="cell?.json || preview">
    <Teleport to="body">
      <DialogBoundary @close="close" :disabled="busy">
        <div class="grid-edit-backdrop">
          <section
            class="dialog grid-edit-dialog"
            role="dialog"
            aria-modal="true"
            :aria-label="cell ? 'Edit JSON' : 'Review changes'"
          >
            <template v-if="cell">
              <h2>Edit JSON · {{ data.columns[cell.column] }}</h2>
              <p>
                Row {{ rowOffset + cell.row + 1 }} · Changes are staged until
                Apply.
              </p>
              <textarea
                autofocus
                aria-label="Cell value"
                :disabled="cell.null"
                :value="cell.text"
                @input="
                  (event) => {
                    const _cell4 = cell!;
                    return setCell({
                      ..._cell4,
                      text: (event.target as HTMLInputElement).value,
                    });
                  }
                "
              ></textarea>
              <label>
                <input
                  type="checkbox"
                  :checked="cell.null"
                  @input="
                    (event) => {
                      const _cell4 = cell!;
                      return setCell({
                        ..._cell4,
                        null: (event.target as HTMLInputElement).checked,
                      });
                    }
                  "
                />
                Set SQL NULL
              </label>
              <button
                @click="
                  () => {
                    const _cell4 = cell!;
                    const formatted = formatCellJson(_cell4.text);
                    if (formatted !== null)
                      setCell({
                        ..._cell4,
                        text: formatted,
                      });
                    else setCellError('Enter valid JSON before formatting.');
                  }
                "
              >
                Format JSON
              </button>
              <template v-if="cellError">
                <p role="alert">{{ cellError }}</p>
              </template>
              <div class="dialog-actions">
                <button @click="close">Cancel</button>
                <button class="primary-button" @click="() => stage()">
                  Stage change
                </button>
              </div>
            </template>
            <template v-else>
              <h2>Review changes</h2>
              <p>
                {{ preview!.length }} rows · Applied together in one
                transaction.
              </p>
              <div class="edit-sql-list">
                <template v-for="(statement, index) in preview!" :key="index">
                  <div>
                    <SqlPreview
                      :value="statement.sql"
                      :engine="engine"
                    ></SqlPreview>
                    <pre>{{
                      statement.parameters
                        .map((p, i) => `${i + 1}: ${JSON.stringify(p)}`)
                        .join('\n')
                    }}</pre>
                  </div>
                </template>
              </div>
              <div class="dialog-actions">
                <button :disabled="busy" @click="close">Back</button>
                <button
                  class="primary-button"
                  :disabled="busy || submitted"
                  @click="() => void apply()"
                >
                  {{ busy ? 'Applying…' : 'Apply changes' }}
                </button>
              </div>
            </template>
          </section>
        </div>
      </DialogBoundary>
    </Teleport>
  </template>
</template>
