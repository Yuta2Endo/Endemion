// ESLint: `npm run lint`. Сервер (functions, src, server, tests) — Node и Workers, public/assets — браузер

import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/", ".wrangler/", "data/", "data-*/", "backups/", "test-results/", "playwright-report/"]
  },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2025,
      sourceType: "module",
      globals: { ...globals.node, ...globals.serviceworker }
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      eqeqeq: ["error", "always"],
      // Управляющие символы в регулярных выражениях намеренные: так их вырезают из текста пользователя (validate.js)
      "no-control-regex": "off",
      "no-var": "error",
      "prefer-const": "error",
      // Вставка HTML из строк запрещена: в интерфейсе текст выводится через textContent и escapeHtml
      "no-restricted-properties": ["error", { object: "document", property: "write" }]
    }
  },
  {
    // Скрипты страниц сайта и страниц Endemion ID (auth/public) выполняются в браузере
    files: ["public/**/*.js", "auth/public/**/*.js"],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    // Браузерные тесты: код внутри page.evaluate выполняется в браузере, пустой {} — фикстуры Playwright без параметров
    files: ["tests/e2e/**/*.mjs"],
    languageOptions: { globals: { ...globals.browser } },
    rules: { "no-empty-pattern": "off" }
  }
];
