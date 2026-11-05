import { mount } from 'svelte';
import App from './App.svelte';
import './theme.css';
import './layout.css';

mount(App, { target: document.getElementById('app') as HTMLElement });
