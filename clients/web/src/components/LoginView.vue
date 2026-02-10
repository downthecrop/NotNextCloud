<script setup>
import { ref } from 'vue';

const props = defineProps({
  onLogin: {
    type: Function,
    required: true,
  },
});

const user = ref('');
const pass = ref('');
const error = ref('');

async function submit() {
  error.value = '';
  const result = await props.onLogin({ user: user.value.trim(), pass: pass.value });
  if (result === false) {
    error.value = 'Invalid credentials';
  } else {
    pass.value = '';
  }
}
</script>

<template>
  <div class="login-screen">
    <form class="login-card" @submit.prevent="submit">
      <div class="login-brand" aria-label="Local Cloud">
        <span class="sr-only">Local Cloud</span>
        <i class="fa-solid fa-cloud"></i>
      </div>
      <div class="meta">Sign in to browse your local storage roots.</div>
      <input v-model="user" placeholder="Username" autocomplete="username" />
      <input v-model="pass" type="password" placeholder="Password" autocomplete="current-password" />
      <button class="action-btn" type="submit">Sign in</button>
      <div v-if="error" class="login-error">{{ error }}</div>
    </form>
  </div>
</template>
