// A bundled example roadmap so the UI is explorable without an API key.
'use strict';

module.exports = {
  id: 'rm_demo_superpowers',
  title: 'Mastering Rust: Systems Programming with Confidence',
  emoji: '🦀',
  summary: 'A hands-on path from Rust basics to shipping a real systems project — built with the Superpowers methodology: small, verifiable steps and one milestone project that proves every skill.',
  difficulty: 'intermediate',
  estimatedDuration: '10-12 weeks',
  source: { type: 'demo', value: '', title: 'Bundled demo roadmap' },
  model: 'demo',
  createdAt: 1731974400000,
  principles: [
    'Learn by shipping: every phase feeds the milestone project.',
    'Make each step verifiable — a test, a command, or a working binary.',
    'Fight the borrow checker early, not later.',
  ],
  milestoneProject: 'A multi-threaded CLI file indexer with a persistent on-disk key-value store, full test coverage, and a published crate.',
  phases: [
    {
      id: 'p1',
      title: 'Foundations & Ownership',
      goal: 'Get fluent with Rust syntax, ownership, borrowing and lifetimes — the concepts everything else builds on.',
      duration: 'Weeks 1-3',
      skills: ['ownership', 'borrowing', 'lifetimes', 'cargo', 'error handling'],
      steps: [
        {
          id: 'p1s1',
          title: 'Install the toolchain and ship "Hello, Cargo"',
          detail: 'Install rustup, create a package with cargo new, run / build / test. Read every line of Cargo.toml until nothing is magic.',
          resources: [{ label: 'The Rust Book — Ch. 1', url: 'https://doc.rust-lang.org/book/ch01-00-getting-started.html' }],
        },
        {
          id: 'p1s2',
          title: 'Ownership drills',
          detail: 'Work through moves, clones and drops. Write 5 tiny programs that fail to compile on purpose; explain each error in a comment.',
          resources: [{ label: 'The Rust Book — Ch. 4', url: 'https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html' }],
        },
        {
          id: 'p1s3',
          title: 'Borrow checker battles',
          detail: 'Rebuild a linked list and a tree using Option<Box<T>>. Accept the pain — this is the rite of passage.',
          resources: [{ label: 'Too Many Lists', url: 'https://rust-unofficial.github.io/too-many-lists/' }],
        },
        {
          id: 'p1s4',
          title: 'Result, ? and custom errors',
          detail: 'Refactor the tree exercises to return Result with thiserror. No unwrap() outside tests.',
          resources: [],
        },
      ],
    },
    {
      id: 'p2',
      title: 'Real Data Structures & Traits',
      goal: 'Model domain data with enums, traits and generics the way the stdlib does.',
      duration: 'Weeks 4-6',
      skills: ['traits', 'generics', 'iterators', 'pattern matching'],
      steps: [
        {
          id: 'p2s1',
          title: 'Design a trait for storage backends',
          detail: 'Define a KV trait (get/set/delete) and implement it for a HashMap-backed store behind a mutex.',
          resources: [{ label: 'The Rust Book — Ch. 10', url: 'https://doc.rust-lang.org/book/ch10-00-generics.html' }],
        },
        {
          id: 'p2s2',
          title: 'Iterator mastery',
          detail: 'Reimplement map / filter / take as your own iterator adapters over a Vec. Then use them in the store\'s scan method.',
          resources: [],
        },
        {
          id: 'p2s3',
          title: 'Serialize the store with serde',
          detail: 'Add JSON persistence with serde + serde_json. Round-trip tests: write, read, assert equality.',
          resources: [{ label: 'serde docs', url: 'https://serde.rs/' }],
        },
      ],
    },
    {
      id: 'p3',
      title: 'Concurrency & The Milestone Project',
      goal: 'Build the file indexer: worker threads, channels, and a crash-safe write-ahead log.',
      duration: 'Weeks 7-10',
      skills: ['threads', 'channels', 'rayon', 'benchmarks', 'CI'],
      steps: [
        {
          id: 'p3s1',
          title: 'Threaded walker with crossbeam channels',
          detail: 'Walk directories on N threads, send results over a channel, aggregate in the main thread. Test with a temp dir fixture.',
          resources: [{ label: 'The Rust Book — Ch. 16', url: 'https://doc.rust-lang.org/book/ch16-00-concurrency.html' }],
        },
        {
          id: 'p3s2',
          title: 'Add a write-ahead log',
          detail: 'Before every mutation, append the op to a log file; replay on startup. Property-test replay with quickcheck-style fuzzing.',
          resources: [],
        },
        {
          id: 'p3s3',
          title: 'Benchmark, polish, publish',
          detail: 'criterion benchmarks, clippy clean, GitHub Actions CI, then cargo publish. Ship v0.1.0.',
          resources: [{ label: 'criterion', url: 'https://github.com/bheisler/criterion.rs' }],
        },
      ],
    },
  ],
  progress: {},
};
