# Writing the cast

How to write a named person for MILO. The rules are checked by `tests/people.test.js` and `tests/sheets.test.js`, and `node scripts/cast-report.mjs` prints everyone's sheet, voice and place.

## Three kinds of people

1. **Companions.** A few. They can be befriended, and if they come to like you they can come to camp. Their file has `camp.early`, `camp.ask`, `camp.yes`, `camp.full`, `camp.role` and `camp.leaves`.
2. **Named locals.** They can be befriended and will never leave their place. Their file has `camp.never` (what they say when asked) and `camp.role`.
3. **Folk.** Everyone else. They are not written one by one: `content/people/folk.json` has names, jobs and lines, and each settlement gets a few. Folk can't be befriended.

Nobody is a prize. A person is someone first, and whether they ever come to camp is theirs to decide.

## Start with the place

Write `where` and `why` before any dialogue. Nobody stands anywhere for no reason: Wendell found the middle of the road, so he stands in it. If you can't say why they are there in one line, they aren't ready.

If they arrive later, say what brings them in `after`: an Act I chapter's id, `{ "genre": "iron" }` for someone who steps out of a mended rift of that genre, or `{ "built": 1 }` for a first building.

## How they speak

These hold for every line a person says.

- **Only what they say.** No stage directions and no narration. Not "He writes this down." Not "A pause." If it matters that he writes it down, he says "I wrote that down."
- **Deadpan.** The reference is *Endacopia*: a long, reasonable setup and a small, flat answer. The absurd is treated as ordinary. They never notice they are funny, and they don't repeat the bit.
- **Plain.** No ellipses, dashes or semicolons. No exclamation marks. No similes or metaphors. Never "it's not X, it's Y". No stacks of one-word fragments for effect.
- **Short.** Each person has a longest sentence (`voice.maxWords`). Stay under it.
- **Theirs.** Each person has a tic nobody else uses, a couple of favourite words, and words they never say. Use the tic now and then: at least twice, in fewer than a third of their lines.
- **Answers aren't labelled.** The player picks words, not an approach. The approach is how the words land.

A line should be tellable from anyone else's. No two people say the same line.

## The file

`content/people/npcs/<id>.json`. In order:

| Field | What it is |
|---|---|
| `id`, `name`, `title` | The first word of `name` is what the notes use ("Wendell approves."). |
| `after`, `where`, `why` | When they arrive, the tile they stand on, and the reason. |
| `dye` | Their colours: the coat rig's keys mapped to palette keys. |
| `threshold` | Approval needed for Fond. Warm is half of it. |
| `likes`, `dislikes`, `resists` | How the five approaches (kind, joke, favour, truth, craft) land. An approach is in one list only. |
| `examine` | Three lines about them, 140 characters at most. This is the one place for description. |
| `meet`, `hello`, `tired`, `finished` | First meeting; a greeting for each level (wary, neutral, warm, fond); the day's limit; nothing left to say. |
| `topics` | Three or more subjects. Each has what they `say` and at least three `options`, one of which they like. An option may `remember` a memory. |
| `errand` | Optional. What they ask once they are Warm. Steps are `visit`, `cook` or `give`. It ends in approval, a memory and a keepsake, never Embers. |
| `memories` | What they will remember, written as the journal says it. |
| `camp` | See the three kinds above. |
| `sheet` | `wants` (`now`, `next` if they have an errand, `really`, `worry`), `favourites`, `aversions`, `temperament`, how they treat `strangers` and `friends`, what `opensUp` and what makes them `goesQuiet`. |
| `voice` | `rhythm`, `maxWords`, `words`, `never`, `tic`, and how they say `hello`, `goodbye`, and sound when `pleased` or `putOut`. |
| `gifts` | `loves`, `likes`, and a reply to every item Milo can gather. Everyone answers every gift. |
| `day` | A line for morning, afternoon, evening, night and rain. |
| `thinks` | What they say about other named people. |
| `recalls` | A line that reaches back to a memory. |
| `helloAfter` | Greetings once their errand is done. Their talk moves on. |
| `arc` | A want, a complication and a kindness. |

## A finished example

Wendell (`content/people/npcs/wendell.json`) is the model. His want is small (someone to stand at the other end of the string), his voice is a fact followed by a smaller fact, his tic is "wrote that down", and the kindness in his arc is somebody telling him that near the middle is enough.

## Before you finish

```
node scripts/cast-report.mjs --check
node --test tests/people.test.js tests/sheets.test.js tests/folk.test.js
```
