---
id: tollkeeper-riddles
with: tollkeeper
once: false
---
# first
Tollkeeper: Good evening. The toll is three riddles, and I do enjoy them. The first: I have a bank but never count my coins. What am I?
> A river. [next: second] [set: riddle:river]
> A miser. [reply: “A fair guess. Misers count all day.”]
> The Tide Market. [needs: fact note:note-20 “Once you’ve read Brannoch’s note”] [reply: “Brannoch would laugh at that. He built this bridge over a river, you know.”]
> Ask if two riddles will do, tonight. [needs: warmth tollkeeper 60] [next: third] [reply: “For a friend, two will do. Here’s the last one.”]
(He leans on the rail and waits, perfectly patient.)
# second
Tollkeeper: Well answered. The second: the more of me you take, the more you leave behind. What am I?
> Footsteps. [next: third] [set: riddle:footsteps]
> Time. [reply: “Close. Time leaves nothing behind but us.”]
> Tea. [reply: “If only. The more tea I take, the more I want.”]
(A moth lands on his hat. He doesn’t move it.)
# third
Tollkeeper: The last one, and my favourite. What can you keep after you’ve given it to someone?
> Your word. [set: riddle:word] [join: tollkeeper] [end]
> A secret. [reply: “Ah, but then it isn’t one.”]
> The Hooklight’s flame. [needs: with milo] [reply: “Lovely, and very nearly. Try once more.”]
(The Murmur runs on under the bridge, saying the last word you said.)
