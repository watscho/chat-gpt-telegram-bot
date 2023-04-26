# [chat-gpt-telegram-bot](https://github.com/watscho/chat-gpt-telegram-bot)

[![](https://img.shields.io/badge/author-@watscho-blue.svg)](https://www.linkedin.com/in/watscho)
[![GitHub license](https://img.shields.io/github/license/watscho/express-mongodb-rest-api-boilerplate)](https://github.com/watscho/chat-gpt-telegram-bot/blob/master/LICENSE)

## Chat GPT Telegram BOT `TypeScript`

- Chat
- Voice messages

### Package list

| Package                | Description                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ts-node                | TypeScript execution and REPL for node.js, with source map and native ESM support.                                                                                                                                                                                                                                                                             |
| ts-node-dev            | It restarts target node process when any of required files changes (as standard node-dev) but shares Typescript compilation process between restarts. This significantly increases speed of restarting comparing to node-dev -r ts-node/register ..., nodemon -x ts-node ... variations because there is no need to instantiate ts-node compilation each time. |
| tsc-alias              | Replace alias paths with relative paths after typescript compilation. You can add aliases that reference other projects outside your tsconfig.json project by providing a relative path to the baseUrl.                                                                                                                                                        |
| tsconfig-paths         | Use this to load modules whose location is specified in the paths section of tsconfig.json or jsconfig.json. Both loading at run-time and via API are supported.                                                                                                                                                                                               |
| typescript             | TypeScript is a language for application-scale JavaScript. TypeScript adds optional types to JavaScript that support tools for large-scale JavaScript applications for any browser, for any host, on any OS                                                                                                                                                    |
| cross-env              | Run scripts that set and use environment variables across platforms                                                                                                                                                                                                                                                                                            |
| dotenv                 | Dotenv is a zero-dependency module that loads environment variables from a .env file into process.env. Storing configuration in the environment separate from code is based on The Twelve-Factor App methodology.                                                                                                                                              |
| eslint                 | An AST-based pattern checker for JavaScript.                                                                                                                                                                                                                                                                                                                   |
| eslint-config-prettier | Turns off all rules that are unnecessary or might conflict with Prettier.                                                                                                                                                                                                                                                                                      |
| eslint-plugin-import   | This plugin intends to support linting of ES2015+ (ES6+) import/export syntax, and prevent issues with misspelling of file paths and import names. All the goodness that the ES2015+ static module syntax intends to provide, marked up in your editor.                                                                                                        |
| eslint-plugin-prettier | Runs Prettier as an ESLint rule and reports differences as individual ESLint issues.                                                                                                                                                                                                                                                                           |
| eslint-plugin-unicorn  | More than 100 powerful ESLint rules                                                                                                                                                                                                                                                                                                                            |
| prettier               | Prettier is an opinionated code formatter                                                                                                                                                                                                                                                                                                                      |

<hr/>

### Setup

You can install Node modules using either [npm](https://www.npmjs.com/) or [Yarn](https://yarnpkg.com/), which are both package managers for Node.js.

```bash
yarn install # or npm install
```

COPY .env.example to .env

```bash
cp .env.example .env
```

### API Start

```bash
yarn start # or npm start
yarn watch # or npm run watch - watch mode
yarn build # or npm run build - production build
```

### ESlint Start

```bash
yarn lint # or npm run link
yarn lint:write # or npm run lint:write - with prefix --fix
```

### Prettier Start

```bash
yarn prettier # or npm run prettier
yarn prettier:write # or npm run prettier:write - with prefix --fix
```

### To install [Prettier](https://prettier.io/) and [ESLint](https://eslint.org/) in [Visual Studio Code](https://code.visualstudio.com/), you can follow these steps:

- Open Visual Studio Code and navigate to your project folder.
- Press Ctrl + Shift + P (Windows) or Cmd + Shift + P (Mac) to open the Command Palette.
- Type "Extensions: Install Extensions" and select the first option that appears.
- In the search bar, type "Prettier" and select the first result that appears.
- Click the "Install" button to install Prettier.
- Repeat step 4 and 5 to install ESLint.

### API Structure

```bash
.
├── src
│  ├── @types
│  │  └── global.d.ts
│  ├── constants
│  │  └── index.ts
│  ├── contracts
│  │  └── telegramBot.ts
│  ├── infrastructure
│  │  ├── index.ts
│  │  ├── oggConverter.ts
│  │  ├── oggDownloader.ts
│  │  ├── openAi.ts
│  │  └── telegramBot.ts
│  └── index.ts
├── .env
├── .env.example
├── .eslintrc
├── .gitignore
├── .nvmrc
├── .prettierrc
├── LICENSE
├── package.json
├── README.md
├── tsconfig.json
└── yarn.lock
```

**Note:** For any question [issues](https://github.com/watscho/chat-gpt-telegram-bot/issues)

## License

This project is an open-source with an [MIT License](https://github.com/watscho/chat-gpt-telegram-bot/blob/master/LICENSE)
