<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { ISearchSolution } from "@/shared/types.ts";

import SolutionDetail from "@/options/components/SolutionDetail.vue";
import SiteName from "@/options/components/SiteName.vue";

const {
  solutions,
  closable = true,
  groupProps = {},
} = defineProps<{
  solutions: ISearchSolution[];
  closable?: boolean;
  groupProps?: any;
}>();

const emit = defineEmits(["remove:solution"]);
const { t } = useI18n();

function removeSolution(solution: ISearchSolution) {
  emit("remove:solution", solution);
}
</script>

<template>
  <div class="pt-1">
    <v-chip-group v-bind="groupProps">
      <v-chip v-for="solution in solutions" :key="solution.id" class="mb-1 mr-1 h-auto py-1" label size="small">
        <template #prepend>
          <v-btn
            v-if="closable"
            class="mr-1"
            color="error"
            icon="$delete"
            size="x-small"
            :title="t('common.remove')"
            variant="text"
            @click.stop="removeSolution(solution)"
          />
        </template>

        <SiteName class="" :site-id="solution.siteId" tag="span" />&nbsp;->&nbsp;
        <SolutionDetail :solution="solution" />
      </v-chip>
    </v-chip-group>
  </div>
</template>

<style scoped lang="scss"></style>
