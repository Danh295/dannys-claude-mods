import type { JargonGlossary, JargonLevel } from '../types'
import { slug } from './text'

/** How far into programming a reader is before they stop needing a term explained. */
export type Tier = 'basic' | 'intermediate' | 'advanced'

// Terms that ship with the mod: they highlight with no model call. Same bar as
// a Haiku definition: jargon a newcomer may not know, defined in at most 18
// plain words without the term itself. Words whose everyday meaning is the
// usual one (path, port, branch, state) are left out; those used both ways
// (commit, shell, queue) are 'basic', so only a beginner sees them linked.
// The tier decides which reader levels see the term (`TIERS_SHOWN`).
const TERMS: ReadonlyArray<readonly [term: string, kind: string, definition: string, tier: Tier]> = [
  // Concurrency and async
  ['idempotent', 'adjective, APIs', 'Doing it twice has the same effect as doing it once.', 'advanced'],
  ['mutex', 'noun, concurrency', 'A lock that lets only one task touch something at a time.', 'advanced'],
  ['race condition', 'noun, concurrency', 'A bug where the outcome depends on which of two tasks finishes first.', 'advanced'],
  ['deadlock', 'noun, concurrency', 'Two tasks each waiting on the other, so neither can ever continue.', 'advanced'],
  ['atomic', 'adjective, concurrency', 'Happens all at once or not at all, never left half-finished.', 'advanced'],
  ['concurrency', 'noun, programming', 'Several tasks making progress during the same period, taking turns or truly in parallel.', 'intermediate'],
  ['async', 'adjective, programming', 'Starts work that finishes later, so the program can keep going meanwhile.', 'basic'],
  ['await', 'keyword, JavaScript', 'Pauses this function until a pending result arrives, without freezing the program.', 'basic'],
  ['callback', 'noun, programming', 'A function handed to other code, which calls it when something happens.', 'basic'],
  ['event loop', 'noun, JavaScript', "The runtime's cycle that picks up finished work and runs the code waiting on it.", 'advanced'],

  // Data and types
  ['hash', 'noun, computing', 'A short fingerprint computed from data; the same input always gives the same one.', 'basic'],
  ['hash map', 'noun, data structures', 'A lookup table that finds a value by its key almost instantly.', 'intermediate'],
  ['queue', 'noun, data structures', 'A line of items handled in arrival order: first in, first out.', 'basic'],
  ['recursion', 'noun, programming', 'A function solving a problem by calling itself on smaller pieces of it.', 'basic'],
  ['serialization', 'noun, data', 'Turning in-memory data into text or bytes that can be saved or sent.', 'advanced'],
  ['JSON', 'noun, data format', 'A plain-text format for structured data, built from lists and key-value pairs.', 'basic'],
  ['YAML', 'noun, data format', 'A plain-text settings format that uses indentation to show structure.', 'basic'],
  ['schema', 'noun, data', 'The agreed shape of some data: which fields exist and what types they hold.', 'intermediate'],
  ['enum', 'noun, programming', 'A type whose value must be one of a fixed, named set of options.', 'intermediate'],
  ['immutable', 'adjective, programming', 'Cannot be changed after it is created; changes make a new copy instead.', 'advanced'],
  ['null', 'noun, programming', 'A value meaning "nothing here"; using it as a real value often crashes.', 'basic'],
  ['boolean', 'noun, programming', 'A value that is either true or false.', 'basic'],
  ['regex', 'noun, text processing', 'A compact pattern language for finding or matching text.', 'intermediate'],
  ['regular expression', 'noun, text processing', 'A compact pattern language for finding or matching text.', 'intermediate'],
  ['UUID', 'noun, identifiers', 'A long random ID that is practically guaranteed never to repeat anywhere.', 'intermediate'],
  ['timestamp', 'noun, data', 'A recorded date and time marking when something happened.', 'basic'],
  ['UTF-8', 'noun, text encoding', 'The standard way to store text from every language as bytes.', 'intermediate'],
  ['base64', 'noun, encoding', 'A way to write any binary data using only letters, digits and two symbols.', 'intermediate'],
  ['truthy', 'adjective, JavaScript', 'Counted as true in a condition, even when not literally true.', 'advanced'],
  ['falsy', 'adjective, JavaScript', 'Counted as false in a condition, like 0, an empty string or null.', 'advanced'],

  // Languages and code
  ['TypeScript', 'noun, language', 'JavaScript with added type labels that catch mistakes before the code runs.', 'basic'],
  ['type annotation', 'noun, programming', 'A label saying what kind of value a variable or argument holds.', 'intermediate'],
  ['generics', 'noun, programming', 'Code written once that works for many types, with the type filled in later.', 'advanced'],
  ['closure', 'noun, programming', 'A function that remembers the variables from the place it was created.', 'advanced'],
  ['polymorphism', 'noun, programming', 'One call working on different kinds of objects, each responding its own way.', 'advanced'],
  ['namespace', 'noun, programming', 'A named container that stops names clashing with the same names elsewhere.', 'intermediate'],
  ['side effect', 'noun, programming', 'Anything a function changes besides returning a value, like writing a file.', 'advanced'],
  ['pure function', 'noun, programming', 'A function whose result depends only on its inputs and that changes nothing else.', 'advanced'],
  ['dependency injection', 'noun, design pattern', 'Handing a component the things it needs instead of letting it build them itself.', 'advanced'],
  ['singleton', 'noun, design pattern', 'A class allowed only one shared instance in the whole program.', 'advanced'],
  ['abstraction', 'noun, software design', 'Hiding details behind a simpler surface so the rest of the code can ignore them.', 'intermediate'],
  ['coupling', 'noun, software design', "How much one part of the code depends on another part's details.", 'advanced'],
  ['refactor', 'verb, programming', 'Restructure code without changing what it does.', 'basic'],
  ['compile', 'verb, programming', 'Turn source code into a form the computer can run directly.', 'basic'],
  ['transpile', 'verb, build tools', 'Convert source code into another language or version, such as TypeScript into JavaScript.', 'advanced'],
  ['runtime', 'noun, programming', 'The environment that runs a program, or the period while it is running.', 'basic'],
  ['boilerplate', 'noun, programming', 'Repetitive setup code needed every time but carrying little meaning.', 'intermediate'],
  ['dead code', 'noun, programming', 'Code that never runs or whose result is never used.', 'intermediate'],
  ['technical debt', 'noun, software practice', 'Shortcuts taken now that slow down future changes until someone cleans them up.', 'intermediate'],
  ['edge case', 'noun, testing', 'An unusual input or situation at the limits of what the code expects.', 'basic'],
  ['off-by-one', 'adjective, bugs', 'A mistake where a count or position is one too many or one too few.', 'intermediate'],
  ['memory leak', 'noun, performance', 'Memory a program keeps holding after it stops needing it, so usage keeps growing.', 'intermediate'],
  ['garbage collection', 'noun, runtimes', 'The runtime automatically freeing memory that nothing uses any more.', 'advanced'],
  ['segfault', 'noun, crashes', 'A crash caused by a program touching memory it is not allowed to use.', 'advanced'],
  ['stack trace', 'noun, debugging', 'The list of function calls that were running when an error happened.', 'basic'],
  ['Big O', 'noun, algorithms', "Shorthand for how an algorithm's time or memory grows as its input grows.", 'advanced'],
  ['memoization', 'noun, performance', "Saving a function's results so repeat calls with the same input are instant.", 'advanced'],
  ['lazy loading', 'noun, performance', 'Loading something only when it is first needed, not up front.', 'intermediate'],
  ['debounce', 'verb, UI programming', 'Wait until rapid repeated events stop, then act once.', 'advanced'],
  ['throttle', 'verb, performance', 'Limit how often something may run, for example at most once per second.', 'advanced'],

  // Command line and operating system
  ['CLI', 'noun, tooling', 'A program you use by typing commands rather than clicking.', 'basic'],
  ['shell', 'noun, command line', 'The program that reads the commands you type and runs them.', 'basic'],
  ['environment variable', 'noun, operating systems', 'A named setting the system passes to programs, often holding secrets or config.', 'basic'],
  ['stdin', 'noun, operating systems', 'The standard channel a program reads its input from.', 'intermediate'],
  ['stdout', 'noun, operating systems', 'The standard channel a program writes its normal output to.', 'intermediate'],
  ['stderr', 'noun, operating systems', 'The standard channel a program writes its error messages to.', 'intermediate'],
  ['exit code', 'noun, command line', 'The number a program returns when it ends; zero usually means success.', 'intermediate'],
  ['sudo', 'command, Unix', 'Runs the command that follows with administrator rights.', 'basic'],
  ['chmod', 'command, Unix', 'Changes who may read, write or run a file.', 'intermediate'],
  ['grep', 'command, Unix', 'Searches files for lines matching a text pattern.', 'basic'],
  ['glob', 'noun, command line', 'A wildcard pattern like *.ts that matches many file names at once.', 'intermediate'],
  ['symlink', 'noun, file systems', 'A file that points to another file or folder, like a shortcut.', 'intermediate'],
  ['dotfile', 'noun, configuration', 'A settings file whose name starts with a dot, hidden by default.', 'intermediate'],
  ['shebang', 'noun, scripting', 'The first line of a script, starting with #!, naming the program that runs it.', 'advanced'],
  ['daemon', 'noun, operating systems', 'A program that runs quietly in the background, usually started with the system.', 'advanced'],
  ['PID', 'noun, operating systems', 'The number the system gives each running program.', 'intermediate'],
  ['cron', 'noun, scheduling', 'A Unix tool that runs commands on a repeating schedule.', 'intermediate'],
  ['SSH', 'noun, networking', 'A secure way to log in to another computer and run commands there.', 'intermediate'],

  // Version control
  ['git', 'tool, version control', 'Records the history of changes to files so work can be shared and undone.', 'basic'],
  ['repository', 'noun, version control', 'A project folder whose full history is tracked by version control.', 'basic'],
  ['repo', 'noun, version control', 'Short for repository: a project folder whose full history is tracked.', 'basic'],
  ['monorepo', 'noun, project layout', 'One repository holding many related projects or packages together.', 'intermediate'],
  ['commit', 'noun, version control', "A saved snapshot of changes in a project's history, with a message.", 'basic'],
  ['diff', 'noun, version control', 'The line-by-line differences between two versions of something.', 'basic'],
  ['rebase', 'verb, version control', 'Replay your commits on top of another branch so history reads as one line.', 'intermediate'],
  ['cherry-pick', 'verb, version control', 'Copy one specific commit from one branch onto another.', 'intermediate'],
  ['stash', 'verb, version control', 'Set uncommitted changes aside for later, leaving a clean working copy.', 'intermediate'],
  ['merge conflict', 'noun, version control', 'Two changes edited the same lines, so a person must choose between them.', 'intermediate'],
  ['pull request', 'noun, collaboration', 'A request to review some changes and merge them into the main code.', 'basic'],
  ['PR', 'noun, collaboration', 'A pull request: a proposed change waiting for review before it is merged.', 'basic'],
  ['fork', 'noun, collaboration', "Your own copy of someone else's repository, which you can change freely.", 'basic'],
  ['.gitignore', 'noun, version control', 'A file listing which files git should never track.', 'basic'],

  // Web and networking
  ['API', 'noun, software', 'A defined way for one program to ask another for data or actions.', 'basic'],
  ['endpoint', 'noun, web APIs', 'One specific URL of an API that accepts a certain kind of request.', 'basic'],
  ['REST', 'noun, web APIs', 'A common style of web API built on URLs and standard request verbs.', 'intermediate'],
  ['GraphQL', 'noun, web APIs', 'A query language letting a client ask an API for exactly the fields it needs.', 'intermediate'],
  ['webhook', 'noun, web APIs', 'A URL another service calls automatically to tell you something happened.', 'intermediate'],
  ['HTTP', 'noun, web', 'The protocol browsers and servers use to send requests and responses.', 'basic'],
  ['HTTPS', 'noun, web', "The encrypted version of the web's request protocol.", 'basic'],
  ['status code', 'noun, web', 'The number a web server sends back to say how a request went, like 404.', 'basic'],
  ['payload', 'noun, networking', 'The actual data carried in a request or message, apart from its headers.', 'intermediate'],
  ['WebSocket', 'noun, web', 'A connection that stays open so server and browser can message each other anytime.', 'intermediate'],
  ['CORS', 'noun, web security', "Browser rules deciding which other websites a page's scripts may fetch data from.", 'advanced'],
  ['DNS', 'noun, networking', "The internet's phone book, turning names like example.com into server addresses.", 'intermediate'],
  ['localhost', 'noun, networking', 'A name that always means this same computer.', 'basic'],
  ['latency', 'noun, performance', 'The delay between asking for something and getting the answer.', 'intermediate'],
  ['throughput', 'noun, performance', 'How much work a system finishes per unit of time.', 'intermediate'],
  ['rate limit', 'noun, APIs', 'A cap on how many requests a service accepts in a given time.', 'intermediate'],
  ['pagination', 'noun, APIs', 'Splitting a long list of results into pages fetched one at a time.', 'intermediate'],
  ['exponential backoff', 'noun, networking', 'Waiting longer after each failed retry, so a struggling service is not hammered.', 'advanced'],
  ['proxy', 'noun, networking', 'A go-between server that forwards requests on behalf of someone else.', 'intermediate'],
  ['CDN', 'noun, web infrastructure', 'A network of servers keeping copies of files close to users, for speed.', 'intermediate'],
  ['load balancer', 'noun, infrastructure', 'A server that spreads incoming requests across several copies of an app.', 'intermediate'],
  ['frontend', 'noun, web', "The part of an app that runs in the user's browser or device.", 'basic'],
  ['backend', 'noun, web', 'The server side of an app: the data, logic and storage users never see.', 'basic'],
  ['middleware', 'noun, web servers', 'Code that runs between a request arriving and its handler, adding a shared step.', 'intermediate'],
  ['DOM', 'noun, web', "The browser's live tree of a page's elements, which scripts can change.", 'intermediate'],
  ['cookie', 'noun, web', 'A small piece of data a website stores in your browser to remember you.', 'basic'],
  ['polyfill', 'noun, web', 'Code that adds a missing feature to older browsers or runtimes.', 'advanced'],

  // Security
  ['authentication', 'noun, security', 'Checking who someone is, for example with a password.', 'basic'],
  ['authorization', 'noun, security', 'Checking what a logged-in person is allowed to do.', 'basic'],
  ['OAuth', 'noun, authentication', 'A standard way to let an app act for you without giving it your password.', 'intermediate'],
  ['JWT', 'noun, authentication', 'A signed token carrying proof of who you are from one request to the next.', 'intermediate'],
  ['encryption', 'noun, security', 'Scrambling data so only someone with the right key can read it.', 'basic'],
  ['sanitize', 'verb, security', 'Clean untrusted input so it cannot be mistaken for code or commands.', 'intermediate'],
  ['SQL injection', 'noun, security', 'An attack that sneaks database commands into input a program trusts.', 'intermediate'],
  ['XSS', 'noun, web security', "An attack that gets a website to run someone else's script in visitors' browsers.", 'advanced'],
  ['CSRF', 'noun, web security', 'An attack tricking a logged-in browser into sending a request its user never meant.', 'advanced'],

  // Databases and caching
  ['SQL', 'noun, databases', 'The standard language for reading and changing data in relational databases.', 'basic'],
  ['NoSQL', 'noun, databases', 'Databases that store data without fixed tables, such as documents or key-value pairs.', 'intermediate'],
  ['Postgres', 'noun, database', 'A popular open-source relational database.', 'intermediate'],
  ['PostgreSQL', 'noun, database', 'A popular open-source relational database.', 'intermediate'],
  ['SQLite', 'noun, database', 'A small database kept in a single file, needing no separate server.', 'intermediate'],
  ['Redis', 'tool, databases', 'A very fast in-memory store, often used for caches and queues.', 'intermediate'],
  ['ORM', 'noun, databases', 'A library that lets code work with database rows as ordinary objects.', 'intermediate'],
  ['migration', 'noun, databases', "A versioned script that changes a database's structure, such as adding a column.", 'basic'],
  ['transaction', 'noun, databases', 'A group of database changes that all succeed together or all fail together.', 'basic'],
  ['primary key', 'noun, databases', 'The column whose value uniquely identifies each row in a table.', 'intermediate'],
  ['foreign key', 'noun, databases', 'A column pointing to a row in another table, linking the two.', 'intermediate'],
  ['N+1 query', 'noun, databases', 'A slowdown from running one extra database query per item instead of one for all.', 'advanced'],
  ['cache', 'noun, performance', 'A store of recent results kept close by so they need not be fetched again.', 'basic'],
  ['cache invalidation', 'noun, performance', 'Deciding when saved results are out of date and must be thrown away.', 'advanced'],

  // Tooling, builds and releases
  ['npm', 'tool, JavaScript', 'The JavaScript package manager: it installs libraries and runs project scripts.', 'basic'],
  ['package manager', 'noun, tooling', 'A tool that downloads and updates the libraries a project depends on.', 'basic'],
  ['dependency', 'noun, software', 'A library or tool your project needs in order to work.', 'basic'],
  ['lockfile', 'noun, tooling', 'A file pinning the exact version of every installed library, for repeatable installs.', 'intermediate'],
  ['semver', 'noun, versioning', 'Version numbers as major.minor.patch, where a major bump signals breaking changes.', 'intermediate'],
  ['breaking change', 'noun, versioning', 'A change that makes existing code relying on it stop working.', 'intermediate'],
  ['bundler', 'noun, build tools', 'A tool that combines many source files into a few files for the browser.', 'intermediate'],
  ['tree shaking', 'noun, build tools', 'Dropping code the app never uses from the final bundle.', 'advanced'],
  ['minify', 'verb, build tools', 'Shrink code by removing spaces and shortening names, without changing behaviour.', 'intermediate'],
  ['source map', 'noun, debugging', 'A file mapping built code back to the original source, for readable errors.', 'advanced'],
  ['linter', 'noun, tooling', 'A tool that scans code for likely bugs and style problems without running it.', 'basic'],
  ['lint', 'verb, tooling', 'Scan code automatically for likely bugs and style problems.', 'basic'],
  ['SDK', 'noun, tooling', 'A kit of libraries and tools for building on a particular platform or service.', 'basic'],
  ['IDE', 'noun, tooling', 'A code editor bundled with tools like debugging, search and refactoring.', 'basic'],
  ['REPL', 'noun, tooling', 'An interactive prompt that runs each line of code as you type it.', 'intermediate'],
  ['debugger', 'noun, tooling', 'A tool that pauses a running program so you can inspect it step by step.', 'basic'],
  ['breakpoint', 'noun, debugging', 'A marked line where the debugger pauses the program.', 'basic'],
  ['hot reload', 'noun, development', 'Applying code changes to a running app instantly, without restarting it.', 'intermediate'],
  ['CI', 'noun, DevOps', 'A service that automatically builds and tests every change pushed to a project.', 'basic'],
  ['CI/CD', 'noun, DevOps', 'Automatic testing of every change, and automatic release of the ones that pass.', 'intermediate'],
  ['pipeline', 'noun, DevOps', 'A series of automated steps, such as build, test and release, run in order.', 'basic'],
  ['deploy', 'verb, DevOps', 'Put a new version of software onto the servers where people use it.', 'basic'],
  ['staging', 'noun, DevOps', 'A copy of the live system for trying releases before real users see them.', 'basic'],
  ['rollback', 'noun, DevOps', 'Undoing a release by going back to the previous working version.', 'intermediate'],
  ['feature flag', 'noun, software practice', 'A switch that turns a feature on or off without releasing new code.', 'intermediate'],
  ['observability', 'noun, operations', 'How well logs, metrics and traces show what a running system is doing.', 'advanced'],
  ['Docker', 'tool, containers', 'Packages an app with everything it needs so it runs the same anywhere.', 'intermediate'],
  ['container', 'noun, infrastructure', 'A lightweight, isolated package that runs an app with its own files and settings.', 'basic'],
  ['Kubernetes', 'tool, infrastructure', 'A system that runs and manages many containers across many machines.', 'intermediate'],
  ['virtual machine', 'noun, infrastructure', 'A whole computer simulated in software, running on another computer.', 'intermediate'],
  ['VM', 'noun, infrastructure', 'A virtual machine: a whole computer simulated in software on another computer.', 'intermediate'],
  ['serverless', 'adjective, cloud', 'Code a cloud provider runs on demand, without you managing any servers.', 'intermediate'],

  // Testing
  ['unit test', 'noun, testing', 'A small automated test that checks one piece of code on its own.', 'basic'],
  ['integration test', 'noun, testing', 'A test that checks several parts of a system working together for real.', 'intermediate'],
  ['end-to-end test', 'noun, testing', 'A test that drives the whole app the way a real user would.', 'intermediate'],
  ['mock', 'noun, testing', 'A fake stand-in for a real component, so a test runs in isolation.', 'basic'],
  ['fixture', 'noun, testing', 'Fixed sample data or setup that tests reuse.', 'basic'],
  ['assertion', 'noun, testing', 'A check in a test that fails loudly when a value is not what was expected.', 'intermediate'],
  ['flaky', 'adjective, testing', 'Passes or fails at random without any change to the code.', 'intermediate'],
  ['regression', 'noun, testing', 'Something that used to work and broke after a later change.', 'basic'],
  ['coverage', 'noun, testing', 'The share of the code that the tests actually run.', 'basic'],
  ['TDD', 'noun, testing practice', 'Writing a failing test first, then just enough code to make it pass.', 'intermediate'],

  // AI
  ['LLM', 'noun, AI', 'A large language model: an AI trained on vast amounts of text to read and write.', 'basic'],
  ['context window', 'noun, AI', 'How much text a language model can take into account at once.', 'advanced'],
  ['prompt injection', 'noun, AI security', 'Hidden instructions in text that trick an AI into doing something unintended.', 'advanced'],
  ['MCP', 'noun, AI tooling', 'A standard way to connect AI assistants to outside tools and data sources.', 'advanced'],
  ['embedding', 'noun, AI', "A list of numbers standing for a text's meaning, so similar texts get similar lists.", 'advanced'],
  ['RAG', 'noun, AI', 'Looking up relevant documents and handing them to a model before it answers.', 'advanced'],
]

/** The bundled terms, slug to entry. Never written to the cache: a cached entry of the same slug wins. */
export const BUNDLED: JargonGlossary = Object.fromEntries(
  TERMS.map(([term, kind, definition]) => [slug(term), { term, kind, definition }]),
)

/** Each bundled term's tier, by slug. */
export const TIERS: Readonly<Record<string, Tier>> = Object.fromEntries(
  TERMS.map(([term, , , tier]) => [slug(term), tier]),
)

export const LEVELS: readonly JargonLevel[] = ['beginner', 'intermediate', 'advanced']
export const DEFAULT_LEVEL: JargonLevel = 'intermediate'

/** A beginner sees every bundled term; each level up hides the tier below it. */
export const TIERS_SHOWN: Readonly<Record<JargonLevel, readonly Tier[]>> = {
  beginner: ['basic', 'intermediate', 'advanced'],
  intermediate: ['intermediate', 'advanced'],
  advanced: ['advanced'],
}

const BY_LEVEL = Object.fromEntries(
  LEVELS.map(level => [
    level,
    Object.fromEntries(Object.entries(BUNDLED).filter(([s]) => TIERS_SHOWN[level].includes(TIERS[s]!))),
  ]),
) as Record<JargonLevel, JargonGlossary>

/** The bundled terms a reader at `level` sees highlighted. */
export function bundledFor(level: JargonLevel): JargonGlossary {
  return BY_LEVEL[level]
}

export function isLevel(value: unknown): value is JargonLevel {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value)
}
