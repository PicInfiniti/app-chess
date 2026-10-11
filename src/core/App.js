import $ from 'jquery';

export default class App {
  constructor(env) {
    this.env = env;
  }

  async init() {
    // jQuery UI expects the global instance before its widgets are loaded.
    window.$ = window.jQuery = $;
    await import('jquery-ui/dist/jquery-ui.js');
    await import('./game.js');
  }
}
