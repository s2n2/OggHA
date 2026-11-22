## 3.21.3 - Video recordings named after the video

- **A video recording is saved under the video's file name** (up to 60 characters), so it loads with that video next time. Recorded again, it replaces that video's earlier script (the card says so). Without a video name it is named by length and date as before.

## 3.21.2 - Range rail, script jump, video scripts

- **Range limits move straight away:** on the stroke range rail, a touch grabs the nearest limit (or the whole band) and drags it at once; the hold before it moved is gone.
- **Script shape and jump in Manual → Script** (Easy card): under the script list, the script's shape as on the Queue card, with where it is. Tap it to jump there: while playing it carries on from there, otherwise Play starts there.
- **A video's own script, more reliably:** a saved script named like the video (or a recording saved as "<video> · 5:24 · <date>") was missed if the saved scripts had not loaded yet when the video was chosen, and of several the first in the list won. Ogg now waits for the list and picks the exact name, else the newest.

## 3.21.1 - Connect Handy card text

- The Connect Handy card's new guidance (what Bluetooth and Wi-Fi each suit) was missing from 3.21.0: a quote in its text kept the card from being rebuilt, so 3.21.0 carried the beta 6 card. Nothing else changes.

## 3.21.0 - The Handy over Wi-Fi

- **Connect Handy card** (`type: custom:ogg-connect-handy-card`): the Handy (firmware 4) over Wi-Fi as well as Bluetooth, switched by hand. It stays the same Ogg device with the same entities, and every card works as usual either way. Bluetooth is unchanged and stays the default.
- **What each is best for:** Bluetooth for everything, with live control (finger, pads) at its quickest. Wi-Fi for scripts and videos, and anywhere the Handy has internet: they are sent ahead into the Handy's own buffer and play smoothly and in time; live control runs about 1.5 s behind, because every move goes through Ohdoki's servers.
- **Keys in secrets.yaml:** the card saves the Handy's connection key and an Application ID (handyfeeling.com developer portal) as `ogg_handy_connection_key` and `ogg_handy_app_id`; administrators only, never shown in full or stored anywhere else.
- **Measured on the Handy and built in:** out of points its stream runs on to the end of the stroke, so Ogg streams with pause-on-starving and re-syncs its clock after a pause; points go in order without waiting for each answer, at most two at a time and no faster than the Handy answers (about one a second), so the delay stays steady; each move keeps its arrival time (no drift) and close moves carry straight on. While Wi-Fi is on, IntiHA's *Connect to this device* is turned off for the Handy, so a Bluetooth reconnect does not interrupt it.
- **Test** on the card: whether the Handy is on Wi-Fi, its firmware, the round trip and the delay.

## 3.21.0b6 - The Handy over Wi-Fi (beta)

- **Paced to the Handy:** beta 5 sent finger moves four times a second with up to ten requests on their way. The Handy takes about one a second over Wi-Fi, so they queued: round trips grew from 1.3 s to over 4 s, the delay grew with them (2 to 2.9 s) and requests timed out. Now at most two are on their way, sent no faster than the Handy answers, so the delay stays steady.

Bluetooth is unchanged.

## 3.21.0b5 - The Handy over Wi-Fi (beta)

Finger control over Wi-Fi did not work in beta 4 (scripts did). From its log:

- **Batches no longer wait for the last answer:** a request that reaches the Handy is answered only once the Handy has taken it, 1-2.6 s over Wi-Fi, and Ogg sent the next batch only after that. A finger's moves queued up behind it and reached the Handy after their time (some 1.3 s late). Batches now go out in order as soon as they are due, several on their way at once.
- **The delay comes from real round trips:** taken from round trips to the Handy itself (the way there is most of one), not the server alone. About 1.3-1.6 s from New Zealand: Ohdoki's servers are in Europe and the Handy's own link to them is the slow part.
- **Back in step when it falls behind:** if the Handy reports its clock behind Ogg's (it paused out of points), the next batch re-syncs it. A bug kept this from happening after a pause.
- **Ready ahead:** the Handy is put in streaming mode with a fresh session as soon as it is online over Wi-Fi (and again after a stop), so the first move does not wait 2-4 s for that.

Bluetooth is unchanged.

## 3.21.0b4 - The Handy over Wi-Fi (beta)

From trying beta 3 by hand (finger control felt awful, scripts unsure):

- **No more drift:** when a move had to start after a point the Handy already had, the whole move was pushed back by the overlap. A script's next point is asked again every second and each live move overlaps the last a little, so the delay kept growing (and the late-point check then raised it further: 1.8 s instead of ~1 s). Every move now arrives at its own time; a point asked again adds nothing.
- **Smooth finger control:** moves reach Home Assistant a little early or late (tens of ms). Each late one got a stop before it and each early one cut the previous turn short, so strokes came out jerky and shallow. A move meant to start within 0.25 s of where the last one ends now carries straight on from it.
- Moves and sends are logged at debug level (custom_components.ogg.handy_wifi).

Over Wi-Fi a finger still runs about a second behind (Ohdoki's servers are in Europe and the Handy's own link to them is the slow part); scripts and videos are read that far ahead, so they stay in time.

## 3.21.0b3 - The Handy over Wi-Fi (beta)

Measured on the Handy (firmware 4.3) with its position read 25 times a second over Bluetooth while it was driven over Wi-Fi:

- **No run-on, without timing tricks:** out of points, the Handy's stream carries on in the same direction to the end of the stroke. Beta 2 sent an end hold just in time, but a hold must reach the Handy about a second ahead over Wi-Fi, and a short move still ran on. The stream now plays with *pause on starving*: out of points the Handy stops where the last one put it (measured: it stays), and the next move puts its clock back in step with Ogg's (measured: the move after a 3 s pause came on time).
- Moves in quick succession still go as simple additions to the buffer, so live control has no extra delay.

## 3.21.0b2 - The Handy over Wi-Fi (beta)

Fixes from testing beta 1 on the Handy (firmware 4.3):

- **No run-on at the end of a move:** when the Handy's stream runs out of points it carries on in the same direction to the end of the stroke (measured: a stream ending at 80 ran to 100). Every last move now ends with a hold point, sent just in time to reach the Handy before the move ends; a move that follows replaces it, so live control gets no extra delay.
- **Bluetooth leaves it alone while Wi-Fi is on:** IntiHA reconnected the Handy over Bluetooth 4 s after it went on Wi-Fi, and that reconnect sends Ogg's usual safety stop, which ends a Wi-Fi stream (and with both links on, the Handy's buffer is ~300 points instead of thousands). While Wi-Fi is on, Ogg turns IntiHA's "Connect to this device" off for the Handy, and back on when Wi-Fi is switched off (only if Ogg turned it off).
- **The live delay is measured:** from when points actually reach the Handy (its own clock), not the round trip to the server alone (the Handy's link to the server is the slow part).
- The first request after a restart (which also sets up the secure connection) no longer inflates the delay; a stale error clears when the Handy is back.

## 3.21.0b1 - The Handy over Wi-Fi (beta)

A beta on the `feat/handy-wifi` branch. Bluetooth is unchanged.

- **Connect Handy card** (`type: custom:ogg-connect-handy-card`): use The Handy over Wi-Fi instead of Bluetooth, switched by hand. Put the Handy on Wi-Fi (its app or button), then switch the card on; switch it off to go back to Bluetooth.
- **The same device either way:** the Handy stays one Ogg device with the same entities, and every card works as before. Only the route underneath changes.
- **Smooth over the internet:** on Wi-Fi the Handy is reached through Ohdoki's Handy API (there is no local Wi-Fi control). Moves go as timed points in the Handy's own buffer (HSP), played by its clock in step with the server's, so a slow request changes nothing:
  - live moves (a finger, held speeds) run a short delay behind, shown on the card (about 0.8 s from here);
  - scripts and recordings Ogg plays are sent up to 20 s ahead;
  - scripts and videos the Play card plays are read that delay ahead, so they stay in time.
- **Keys in secrets.yaml:** the card saves the Handy's connection key and an Application ID (from the handyfeeling.com developer portal) as `ogg_handy_connection_key` and `ogg_handy_app_id`. Only administrators can set them, and they are never shown in full or stored anywhere else.
- **Test** on the card: whether the Handy is on Wi-Fi, its firmware, the round trip and the live delay.

## 3.20.3 - Smooth slow control, no runaway jumps

- **Slow finger control is smooth:** moving the stroke bar (or the slider on a video) slowly, the card held back changes under 1.5% and then sent them as one quick hop, so the stroker stood still most of the time and jumped a little every few hundred ms (measured: still 72% of the time at 5%/s, hops five times the finger's speed). Now every step of about 1% goes, at the finger's own pace, so the steps join up. A finger resting with a little shake still sends nothing.
- **Jumps to the wrong place: fixed in IntiHA 2.8.1.** The Handy was told never to stop at a move's target, so whenever the next move was late it ran on towards an end of the stroke. Update IntiHA to 2.8.1 too.
- **The slider under a video means the same place whether recording or not:** on the Play card, sliding it by hand put the stroker at that position, while recording spread the slider over the stroke range, and a recording started from a position read on the wrong scale (a jump at the start whenever the range was not 0-100). Now it is spread over the range in both, as a script is.

## 3.20.2 - Fast finger strokes keep their depth
- **Each live move lands:** dragging the stroke bar (or the line on a video, or a pad), a move went every 60-80 ms even when it was planned to take 200 ms, so the next one cut it short. The Handy starts each move from wherever it is, so a cut-short stroke never reached its turn, and fast strokes came out shallow and wandering in the middle (measured on the Handy itself). Now a move is replaced only once it has landed. A finger faster than the stroker can go gets full strokes at the stroker's top speed, skipping wiggles it cannot do, and never more than a quarter second behind.
- **Short strokes everywhere? Check The Handy's own stroke zone.** Every move is a share of the stroke zone set on the Handy (buttons or its app). A Handy here was set to 28 mm of its 100 mm, which made every stroke short and every speed look the same. IntiHA 2.8.0 shows and resets it (`intiha.handy`: `status`, `stroke_set`).
- Test data uses made-up Bluetooth addresses only.

## 3.20.1 - Manual stroking does what the finger does
- **A swipe takes over:** with a speed latched, swiping the position lane only paused it - the moment the finger lifted, the latch carried on and sent the stroker back to a limit. A swipe now stops the latch; the stroker stays where you let go.
- **The range is not moved by accident:** the range rail sits right beside the position lane, and a swipe that landed on it dragged a limit to wherever the finger stopped (strokes of a few % followed). A limit now moves only after a short hold (about 0.2 s); a quick swipe on the rail does nothing and says so.
- **Catching the finger:** touching the lane away from the stroker, it now catches up at its full speed (it glided there more slowly, following the bar rather than your finger).

## 3.20.0 - Strokes at the stroker's real speed
- **Real top speed:** the card took a full stroke in a quarter second as top speed, faster than The Handy can go (110 mm at about 350 mm/s: ~310 ms), so at Fast it turned back short of the ends and looked slower than the bar. Held speeds, moods, the AI stroke planner (card and Home Assistant) and live control now use the stroker's real top speed, so strokes keep their full depth.
- **Live control copies the finger:** dragging the stroke bar, the line on a video or a pad replays your finger's own path about 0.2 s behind, in 60 ms moves that each take exactly as long as your finger did - its real speed, with a move ending at every turn, never faster than the stroker goes. No guessing ahead, no overshoot, nothing chased while you hold still.
- **New cards reach phones:** the Play card's address now changes with the card itself, so phones stop holding on to an old copy after an update (reloading Ogg is enough; no restart).

## 3.19.1 - Live stroker control keeps up
- **Faster, truer live control of a stroker** (dragging the stroke bar, the line on a video, pads): measured on The Handy, Bluetooth now carries a move in about 60 ms, so the card's cautious pacing was the bottleneck - every move lasted 230 ms (a fast stroke came out at under half its depth) and the stroker carried on for about half a second after the finger stopped. Now a move goes every 80 ms, aimed where the finger is heading (its speed over the last 0.1 s, capped so a turn is barely overshot): the stroker moves at the finger's speed, lags it by about a tenth of a second, and stops a moment after it does. A trembling finger at rest is still not chased.
- Touching the stroke bar away from where the stroker is: it glides there at a brisker pace (at least 60%).

## 3.19.0 - Record with a video, the easy way
- **● and 💾 on the video** (Play card and the Easy card's Video): ● starts the video and records together, so it is in sync from the first frame; move the line on the video with the action (a stroker's position, a vibrator's strength) and your toys follow live. ■ stops both; 💾 saves it to your scripts (named after the video) and it plays with that video straight away; ✕ discards it. Recording again over part of it replaces that part.
- The icons sit in the top right corner and fade with the video's own controls (back on a tap or when paused); the lines on the video are thicker and easier to catch.
- Stroke recordings are saved clean (every turn and pause, no finger wobble), and a hold is recorded as a hold (it used to creep slowly to the next move).
- The Easy card's Video section records strokes when a stroker is picked (it could start in the kind used last).

## 3.18.2 - Saved scripts on a stroker from Home Assistant
- **`ogg.studio_play` on a stroker** (automations, scripts, the saved-script entities): a stroke script was first turned into vibration levels meant for a vibrator, and those levels were then played as positions - the stroker jumped about instead of following the script. A stroker now plays a stroke script as it is, and a vibration script as strokes by feel (the same planner as the cards, now in Home Assistant too and checked against the card's), inside its stroke range.

## 3.18.1 - Patterns and recordings stroke smoothly
- **Patterns and vibration recordings on a stroker:** the Easy card's patterns (and scripts) and the Queue's recordings were sent to a stroker as positions, so every pulse or step in the level was a jump - 30% or more of the stroke in a twentieth of a second, dozens of times a minute (Pulse, Heartbeat, Echo, Chachacha, Tempo). A stroker now gets strokes that follow the pattern's or recording's feel (its rhythm and intensity as stroke speed and depth): no jumps, no move quicker than the Bluetooth link carries. Stroke recordings and moods (which have their own stroke track) play as they are.

## 3.18.0 - Smooth strokers
- **Smoother Handy (and other strokers):** a stroker's moves are Bluetooth writes that took 100-300 ms (sometimes nearly a second) to land through a proxy. Dense or wobbly timelines asked for more moves than that carries, and Ogg waited on each acknowledgement, so the stroker rushed, stopped and lurched, then caught up in a burst.
  - Stroke timelines are cleaned before they play (patterns, moods, scripts, queues, recordings, video sync): every real turn, pause and change of speed stays; points on a straight line, wobbles under 4% and moves quicker than 150 ms go. Strokes too fast for Bluetooth keep their depth at a pace it carries.
  - The player sends each move alongside the timeline and aims it at its point's time: a slow acknowledgement no longer holds the timeline back or causes a burst.
  - Live control (dragging the stroke bar, pads, video and sound following) is smoothed and paced to what the link carries, each move overlapping the next so the stroker keeps moving; a finger at rest is not chased, and letting go settles gently where it ended instead of jumping. It trails the finger by a fraction of a second.
  - New stroke recordings are saved clean (turns, pauses and speed changes, without the finger's wobble).
- Works best with IntiHA 2.7.0, whose stroker moves no longer wait for each Bluetooth write's response.

## 3.17.3 - Stroker scripts play again
- Patterns, moods and scripts played by Home Assistant on a stroker (the Easy card, queues, screen off) ended before their first move with recent Home Assistant versions, which start background tasks straight away. They play again; manual controls were never affected.

## 3.17.2 - Easy card double-tap
- Easy card: double-tap to drop a slider to zero works on a phone now (the finger no longer puts it straight back).

## 3.17.1 - Stop all on the Easy card
- Easy card: the big ■ Stop is now ■ Stop all, which stops everything Ogg plays on every card and toy (like the Play card's).
- Easy card: a Stop all from another card stops what it is playing too.

## 3.17.0 - Video delay per toy
- Every toy's ⚙ settings has a Video delay: − / + in 25 ms steps (up to 2 s), tap the number for none.
- Video sync plays each toy's script at its own time: + later, − earlier, so toys with different lag line up with the video.
- Kept in Home Assistant with the toy's limits, so every card and phone uses it.

## 3.16.3 - Easy card tidy-up
- Easy card: the people count is a small outlined badge again (under "Ogg").
- Easy card: "Play now" is now "Manual".

## 3.16.2 - People count as the Easy card's title
- Easy card: "👥 2" (people with an Ogg card open; tap for who) takes the place of "Easy", to save room. A title set on the card still shows.

## 3.16.1 - Viewers badge with the Control Deck
- The 👥 badge shows when the Control Deck is on the same page (its copy of the shared feed dropped the viewer list).

## 3.16.0 - Who is viewing
- 👥 in the Play, Easy and Queue cards' headers: how many people have an Ogg card open right now; tap it for who (and on how many devices). People, not tabs: one person on a phone and a laptop counts once.
- An "Ogg Viewers" sensor: the count, with the names in its attributes.
- Needs a Home Assistant restart (the count lives in Ogg).

## 3.15.0 - Connect and whose toy in the settings
- ⚙ settings pop-up (Play, Easy and Queue cards): a "Connect this device" switch (off: Ogg sends it nothing; Bluetooth stays connected) and Unassigned / His / Hers.
- Every toy has his/hers now, a stroker such as The Handy too (it had none).
- Needs a Home Assistant restart (the new his/hers selector for strokers).

## 3.14.0 - Toy chips with settings
- Play card: the toys are chips, like the Easy card: tap a toy to use it here (up to four; tap again to stop), and the ones in use show which pad they follow. A toy in use elsewhere shows "in use": tap it to take control.
- ⚙ before each toy's name opens its settings: its limits (top intensity, stroke range, top stroke speed: kept in Home Assistant for every card), and on the Play card what it plays (both motors, motor 1 or 2, stroker) and how it follows a stroke.
- The Easy and Queue cards have the same ⚙ on their chips.

## 3.13.0 - The Play card's stroke controls everywhere
- Easy card: Stroke now uses the Play card's own stroke controls (range, position, Fast / Medium / Slow with Latch, Set limit / Reset limits) for the strokers picked there. It never changes your own Play card's devices.
- Play card, Together: their stroker gets the same stroke controls under "Their toys" (a vibrator keeps the level slider).
- Partner page: Stroke has the same layout too: range, position, three speeds to hold or latch, and limits.
- Needs a Home Assistant restart (with 3.12.0).

## 3.12.0 - Together: their toys, strokers and drop to 0
- Play card, Together: a "Their toys" control plays the toys your partner picked as theirs: a level for a vibrator, a position or ▶ Stroke for a stroker. Your own controls now stay on your own toys (with Sync, they play both, as before).
- Partner page: a Vibe / Stroke switch on Manual; it picks Stroke by itself when the toys they play are a stroker such as The Handy (drag to move it, or ▶ Stroke with speed and length).
- Partner page: "Drop to 0 when I let go" replaces double-tap, which did not work on phones.
- Needs a Home Assistant restart (the partner page and its messages live in Ogg).

## 3.11.0 - Stroker controls on the Easy card and Control Deck
- Easy card: Manual has a Vibe / Stroke switch in its corner. Stroke drives a stroker such as The Handy: drag the bar to move it, or ▶ Stroke to go up and down at a speed and length (inside its limits). It starts on Vibe, or on Stroke when only strokers are picked; flip it any time.
- Record follows the switch, so a stroke can be recorded (and saved as a stroke script) for a partner with only a vibrator here, and the other way round.
- Control Deck (card v2.5.0): connected strokers are listed, with a position slider and Stop (they were hidden, having no Pulse or Run).

## 3.10.3 - Manual stroker controls
- Play card: the manual stroke controls (drag the bar, Fast / Medium / Slow, Latch) move a stroker such as The Handy again. Its hidden "devices follow" switch missed a device being picked, so manual moves were never sent (scripts were unaffected). Now any picked, active device follows.

## 3.10.2 - Lock on the Easy card
- Easy card: a 🔒 button in the header (shown when discreet mode or a PIN is set). It covers every Ogg card again and locks PIN-locked Play cards straight away.

## 3.10.1 - Search from the Easy card
- Easy card: a small ↻ beside the toy count searches for toys; it spins while searching (tap again to stop). Shown while Ogg is on.

## 3.10.0 - Six starter scripts
- Six ready-made vibration scripts are added to the library once: Quickie (5 min), Heartbeat (10), Surprise ride (15), Ocean waves (20), Slow burn (25) and Edge ladder (30). They are original, following the shapes popular scripts use: a quick climb, a rising beat, an irregular ride, sets of waves, a long slow build, and tease-and-denial edges.
- They show under Saved scripts everywhere (Play, Easy, Queue, video). Rename or delete them like any other; a deleted one is not added back. A device's top-intensity limit still applies.
- Queue card: ✏️ Rename beside the script picker (saved scripts, queue items, and one being built).
- Needs a Home Assistant restart.

## 3.9.0 - Play from the middle, phone off
- Queue card: playing from part way through now runs entirely in Home Assistant. It plays to the end of the script and, with Loop on, goes round the whole script from the beginning, even if the phone sleeps or disconnects.
- ogg.play_script: new start_ms option (start this far in; a loop then goes round from the beginning), for motors and strokers.
- Needs a Home Assistant restart.

## 3.8.4 - Queues for videos
- The video's script list includes his and hers queues and the played list (as on the Queue card), above the saved scripts.

## 3.8.3 - Rename on the Easy card
- Easy card: ✏️ Rename beside the chosen script under Script.

## 3.8.2 - Drop to 0 on the Easy card
- Easy card: "Drop to 0 when I let go" under the sliders (remembered in each browser).

## 3.8.1 - Clearer queue steps
- Queue card: each step stands apart, with a coloured edge, tint and numbered badge for its kind (pattern, mood, script, pause).
- In the Easy card, Queue & replay has no heading of its own and plays on the toys picked at the top.

## 3.8.0 - The Easy card
- **Ogg Easy** (`type: custom:ogg-easy-card`), the simple one:
  - **Connect now** switches IntiHA and Ogg on; **Disconnect** switches both off so toys can sleep.
  - The connected toys, with their live level; tap to choose which play.
  - **Play now:** one or two sliders (as the toys and motors need), Ogg's patterns and moods, saved scripts; **Record** and **Save** ("His save" / "Hers save" with the date and time).
  - **Queue & replay:** the Queue card. **Other:** video and sound, folded.
- The Play card can show just its video and sound (`media_only: true`), as the Easy card's Other does.

## 3.7.3 - Real names once opened
- Discreet cards no longer rename toys "Device A, B…" or hide the title: they are covered until More, and then show everything as usual.

## 3.7.2 - A different saying on every card
- Each covered card shows its own saying, never the same as another card on the screen, and a new one each time it covers again. Twice as many of Ogg's own sayings.

## 3.7.1 - Covers fixed
- A covered card no longer shows an empty PIN box (or More for someone not chosen): the PIN box appears only after More, when a PIN is set.
- Examples and tests use made-up names.

## 3.7.0 - A saying on every covered card
- **Someone not chosen** under "Who may use OggStudio" now sees only a saying on every Ogg card (Play, Queue, Privacy, Control Deck), not the card.
- **Discreet cards** show the same saying with **More**; More (and the PIN, when set) opens every Ogg card in that browser for two hours, then they cover again. Lock now covers them all at once.
- **Cover sayings** (Configure > Studio): your own, one per line, kept in your Home Assistant; otherwise Ogg's own cheeky ones.

## 3.6.0 - His and hers are people
- **Who his and hers are:** Ogg's options (Configure > Studio) gain "His is" and "Hers is", each a Home Assistant user (shown by their person name).
- **Queue card with names:** the queue tabs and buttons use their names ("Add to Sam's queue"), and it opens on the queue of whoever is signed in.
- **A Send link reads right for each person:** the one it is for sees "Alex sent you…", the sender sees "You sent Sam…", and anyone else sees "Alex sent Sam…". Queued scripts now remember which user sent them.

## 3.5.0 - Together: both switches on both screens
- **Sync both is shared:** your partner can switch it on their Together page as well, and whoever changes it, both screens show the same.
- **Your partner's consent:** their page has "Let my partner play my toys" for the toys they picked. Off, your controls leave their toys alone and your card says they have paused it.

## 3.4.1 - Queue card layout; one place for queues
- Queue card: **His & hers queues** now sits above **Make a queue**, and both have a heading you can tap to fold (remembered in each browser).
- The Play card's own ☰ Queue section is gone: the Queue card does more (his and hers queues, a played list, timed steps, Send). Saved playlists stay in Ogg and still play with the `ogg.studio_*` services.

## 3.4.0 - Together: the queue on the partner's page
- **Queue tab on the Together page:** your partner can play anything from his or hers queue or the played list, and make their own from patterns, moods and pauses (any time, drag to reorder) to play now or add to his or hers queue. It plays on your toys like their patterns do, inside your limits. Your card tells you when they add one.
- **Their toys:** the "Which toys are yours?" picker is always shown. When none are free it says why: you are using every connected toy.
- The link reaches only the queues: listing them, playing one, marking it played and adding one (up to 30 a session, about an hour each), and only while the link is live.

## 3.3.1 - Queue card: connected toys, live levels
- The Queue card lists only connected toys, each with its live level (vibration, both motors) or stroke position.
- With no toy selected (or none connected), Play simulates: the player runs, nothing is sent, the card says so, and a simulated toy shows the level or position the script would play.
- Step times now start at 5 and 10 seconds, and **Custom…** takes any time, like 7, 45s, 1:30 or 2m.

## 3.3.0 - Queue card: make one, send it
- **Queue card** (`type: custom:ogg-queue-card`), a card on its own:
  - **Make a queue:** patterns, moods, saved scripts and pauses, each for a set time (15 s to an hour), with strength and speed. Drag the handle to reorder. Built for vibrators or for a stroker.
  - **Save it:** to his or hers queue, to your scripts, or copy its code. The name defaults to its length plus the date and time.
  - **His and hers queues and a played list:** play one and it moves to Played, where you can play it again or put it back in a queue.
  - **Send:** copies a link that opens the dashboard with that script ready to play, and says who sent it.
  - **Player:** speed, loop, tap the bar to jump, and pick the toys to play on (by default his toys for his queue, hers for hers). Ogg plays it in Home Assistant, so it carries on with the screen off. It also becomes the current take on any Play card on the page.
- New services `ogg.studio_queue_add`, `_get`, `_played`, `_requeue`, `_rename` and `_delete`. The queues are stored apart from the library.

## 3.2.0 - Private mode
- **Private mode:** a new Privacy card (`type: custom:ogg-privacy-card`) with one switch. On, Ogg's toys stop showing their status to everyone else in Home Assistant: other users, history, the logbook and automations keep seeing what was there when it was turned on. Whoever turned it on still sees everything live on the Play card and the Control Deck, on every device they are signed in on. Only they (or the Home Assistant owner) can turn it off; it stays on across restarts. The toys keep working for everyone.

## 3.1.0 - Keeps playing with the screen off
- **Screen off:** a pattern, mood, Library script or queue started on the Play card keeps playing when the phone's screen turns off or the app goes to the background. The card hands each device's timeline to Ogg, which plays it in Home Assistant; back on screen, the card carries on from where Ogg is. Patterns and moods loop for up to an hour without the phone; a script or queue plays to its end. Not with a video, sound or a Together partner (they need the phone). Closing the page or Stop all still stops everything.
- `ogg.play_script` gains `output` (`auto`, `vibrate` or `linear`: strokers can now play a timeline in Home Assistant) and `max_seconds` (a time limit, also for loops). A stroker's timeline ends on its Stop, Stop all, Ogg off, a disconnect or any live command.
- A new two-motor device starts on the two-motor steady pattern (it started on the one-motor one).
- Ogg cancels its pending wake-up timers when it unloads.
- The test suite is up to date and passes in full.

## 3.0.0 - OggStudio is part of Ogg
- **The Play card is built in.** OggStudio's card and services now ship inside Ogg: add the card with `type: custom:oggstudio-play-card` (the old OggStudio card types still work and show the Play card). Ogg registers it as a dashboard resource, like the control deck.
- **One card for everything:** up to four devices (1 and 3 follow pad 1, 2 and 4 pad 2), manual, Ogg's patterns, moods and the Library; recording with Save/Download; video with a matching script picked automatically and an overlay for fullscreen; sound; Script editing; Queue; Lock & PIN; Extras.
- **Together:** share a link and your partner gets a full remote (pad, patterns, moods). Toys you are not using are offered with their his/hers tag and your partner picks theirs; your controls then play their toys and theirs play yours. **Sync** makes both play both, and **Record partner** keeps what they send as a take to play again.
- **Privacy:** videos are never stored on Home Assistant; casting streams through the card. Discreet mode, PIN and auto-lock are in Ogg's options (Configure → Studio), and changing them no longer reconnects Ogg.
- **Moving from OggStudio:** on first start Ogg takes over OggStudio's saved scripts, queues and settings, and shows a repair until the OggStudio integration is removed. Remove it (and its HACS download) afterwards; Ogg then drops its old card resource. Services are now `ogg.studio_*`.
- New entities on an "Ogg Studio" device: saved script, replay speed and Stop everything.

## 2.5.0 - Live linear for strokers
- New `ogg.linear` service moves a stroker (The Handy, Launch, Keon) to `position` 0-100 over `duration` ms with a single LinearCmd and no stop first, for live following such as OggStudio's Stroker mode. Calls never queue: the newest target wins. The device's Position entity shows the last target. Existing services are unchanged.

## 2.2.0 - Chart shows actual output
- In **Random** mode, during **OggStudio** script playback and with OggStudio's live pads, the card's chart now plots the levels Ogg actually sends (both lines on two-motor devices) instead of the pattern's theoretical shape.
- Each device's Status sensor carries the current `output` levels and `output_source` while running; these attributes are excluded from history so the database is not filled.

## 2.1.1 - Pulse option
- The card's 7 s pulse duration option is now 6 s.

## 2.1.0 - Script playback API (for OggStudio)
- New `ogg.play_script` service plays a funscript timeline (`pos` 0-100 as intensity) on a device, with speed (0.25-4x) and loop; a second motor can be given as `channels.V1`. A one-channel script drives every motor. Playback runs inside Ogg's own frame loop for accurate timing and ends with a stop.
- New `ogg.live` service sets live motor levels (sliders) and stops by itself shortly after the last call, like Hold.
- New `ogg.stop_script` service.

## 2.0.0 - Two servers at once
- **Two servers at once:** turn on "Connect to two servers at once" in Ogg's settings to keep the local IntiHA server and one other server (for example your phone's Intiface app) connected together. Devices from both appear as one list and commands go to the right server automatically. With IntiHA off, Ogg simply runs on the other server; it picks IntiHA up again within seconds when it is switched back on.
- **Automatic IntiHA search** when Ogg connects and when a connected device has been offline for 30 seconds (45 s, IntiHA only).
- **Card:** blocked devices show only their name, status and chips; 7 s pulse option.
- Includes the 1.1.0 betas (b1-b3) below.

## 1.1.0b3 - Auto search, tidier blocked devices (beta)
- **Automatic IntiHA search:** when Ogg connects, and when a device that was connected has been offline for 30 seconds, Ogg starts a short search (45 s) on the local IntiHA server only, never on the phone. IntiHA then retries its known devices immediately. The user Search toggle is unchanged.
- **Blocked devices** show only their name, status and chips on the card; tap Blocked to allow the device and bring its controls back.
- **Pulse duration** gains a 7 s option on the card.

## 1.1.0b2 - Two servers at once (beta)
- Servers are now told apart by the name they report when connecting: the local **IntiHA** server always takes the "house" slot and any other server (for example your phone's Intiface app) the second slot, whatever order the addresses are listed in. The same phone reachable at two addresses (VPN and Wi-Fi) is only connected once.

## 1.1.0b1 - Two servers at once (beta)
- New option **Connect to two servers at once (beta)** in Ogg's settings (off by default). Ogg keeps the first configured address (normally this Home Assistant's IntiHA) and one other reachable address (for example your phone running Intiface) connected together, so house devices and phone devices can be played simultaneously.
- Devices from both servers appear as one list; which server a device is on is invisible. Commands are routed to the device's own server automatically.
- If one server drops, only its devices go offline and that server is retried in the background; Ogg only reports disconnected when no server is reachable. Search starts and stops scanning on both servers.
- IntiHA's Bluetooth-address identity is read from each connected server, so the same toy stays one device.
- With the option off, behaviour is unchanged from 1.0.0 (one server at a time, failing over between addresses).

## 1.0.0 - First stable release
- **Hold to run:** every device has a hold button (two-motor devices: Hold 1 and Hold 2, one per motor). It runs the device's pattern while held and stops on release; if the card stops refreshing (released, closed, connection lost) the output stops by itself within about a second. New `ogg.hold` service.
- **Search** is now a toggle (switch "Search for devices") using the standard Buttplug StartScanning/StopScanning. Ogg no longer scans continuously; a search stops when the server reports it finished, when switched off, or after 5 minutes. The card's Search pill shows the toggle.
- **His / hers:** each device has an Owner setting (Unassigned/His/Hers) with a small chip on the card; the device list can be filtered All/His/Hers, and Pulse all / Stop all then act on the shown devices only.
- The separate Pulse in / Pulse out buttons were removed (single Pulse button again); old entities are cleaned up automatically.
- Includes everything since 0.1.13: device identity and duplicate cleanup, connection feedback, two-motor patterns, Random mode, compact server tiles and the two-line sparkline.

## 0.1.19 - Two-motor control
- **Two-motor devices** (e.g. a two-motor We-Vibe) now use a full two-motor pattern set instead of the single-motor list: Steady/Pulse/Wave (both), Ping-pong, Chase, Counter wave, Breath (offset), Heartbeat and Double pulse (in, then out), Echo bounce, Ramp swap, Steps cross, Tease pulse, Rumble pulse and Surge layer, plus Random. Saved single-motor patterns switch to Steady (both).
- **Pulse in / Pulse out** buttons (new entities) pulse just the inner or outer motor; the card shows **In / Out / Both** instead of a single Pulse button for two-motor devices. Random on two-motor devices uses the two-motor set and steps the motors out of phase.
- **Card:** two-motor devices show both motors in the sparkline (teal = in, violet = out). Server tiles show the real state (Disabled, Connected, Connected · searching, Engine offline, Searching, Reconnecting, …). A **Search** button under the connected count starts a device search on whichever server Ogg is connected to. The Motors selector is replaced by the In/Out/Both buttons.

## 0.1.17 - Two-motor patterns, Random mode
- **Two-motor patterns** (shown only for two-motor devices such as a two-motor We-Vibe): Ping-pong, Chase, Counter wave, Tease pulse and Rumble pulse, each driving the two motors differently.
- **Random mode** for every device: intensity sets how often it runs (about intensity squared: 100% almost continuously with brief silent gaps, 50% about a quarter of the time, 10% about 1%). Each burst has a random pattern or step sequence (including silent steps), speed, cycle time and length; two-motor devices also get random motor combinations.
- **Card:** a **Motors** selector (Together / Alternating / Motor 1 only / Motor 2 only) appears for two-motor devices. In Random mode the card shows **How often** instead of Intensity and hides Cycle time. Status colour fix for the server tiles.

## 0.1.16 - Compact server tiles
- HA Server and Ogg tiles are a single compact row (about half the previous height).
- Status reads **Connected** when Ogg is connected to a server (otherwise "Looking for server"), and for IntiHA when its engine is connected ("Searching…" while a scan runs, "Waiting for engine" otherwise).
- IntiHA's tile shows a **Search devices** button while IntiHA is on and connected to its engine.

## 0.1.15 - Duplicate cleanup
- On load, a device identified by Bluetooth address absorbs older name-only records of the same model; the oldest record keeps its entity IDs and settings and takes the current route. Different explicit display names are never merged.
- Offline Ogg devices can now be deleted from their Home Assistant device page (live devices and the Ogg hub cannot).

## 0.1.14 - Connection feedback and IntiHA identity
- New **Connection feedback** setting (Silent / Short pulse). With Short pulse, a device that connects or reconnects gives one 0.2 s buzz at 30%, followed by the usual stop and resume. Default is Silent.
- Ogg reads Bluetooth addresses from IntiHA (`/intiha/devices`) so the same toy is one device across reconnects and servers.
- Pulse all and Run all start devices one after another with a short gap instead of in one burst.
## 0.1.13 - Compact server controls
- HA Server and Ogg return to one horizontal pair of compact tiles at mobile dashboard widths.
- Each tile keeps its own settings gear, On/Off state and toggle on two tidy internal lines, avoiding overlapping switches and the 2x vertical height of v0.1.12.
- No backend, pulse STOP watchdog or sensor changes; existing dashboard resources update to a new cached version.

## v0.1.12 — Card layout and feedback clarity

- Server settings and switches now appear in independent full-width rows until the card has room for two wide tiles, avoiding collisions in section views.
- Device names can occupy two lines, with the target/feedback sparkline to the right and the Allowed badge underneath.
- A footer version marker helps identify stale browser-cached card resources.
- Refresh the bundled resource during Ogg integration reload as well as Home Assistant startup.
- No changes to Ogg pulse timing, STOP safety net or physical motor commands.

## 0.1.12 - Responsive Control Deck layout fix
- Prevent HA Server/Ogg switches and settings links colliding inside narrow dashboard columns.
- Lay out server tiles with controls on their own lower row when the card is narrow, then restore a horizontal layout in wider cards.
- Use CSS container queries so the mobile layout responds to the actual dashboard card width, even when Home Assistant is open in a desktop browser or a narrow grid section.
- Preserve the v0.1.10 dual intensity traces, v0.1.8 repeated pulse STOP watchdog, and all existing control entities and service calls.
- Bump the auto-registered Lovelace resource URL to refresh cached JavaScript after HACS update.

## 0.1.10 - Target versus device-reported waveform
- Show two independent tracks in the Ogg Control Deck: a dim dashed **target** pattern and a brighter solid **device-reported** level from IntiHA b19, when the sensor is available.
- Discover feedback sensors by a unique match to the Home Assistant device name, or map manually via `reported_intensity_entities` when aliases differ. Never assume two devices are the same just because both say We-Vibe.
- Missing, stale, or disconnected feedback stays blank (never faked as measured zero); the target preview still works on other servers and unsupported devices.
- Keep the card frontend-only, preserve the pulse STOP safety-net and all server/device controls. The external Buttplug protocol is unchanged.

## 0.1.9 - Animated per-device pattern sparklines
- Add a small, scrolling intensity waveform beside each connected device name in the bundled Ogg Control Deck, optimised for narrow mobile screens.
- Preview the selected software pattern at the configured cycle period and intensity, including a baseline and stop decay; native firmware output remains an approximation, not motor telemetry.
- Keep the graphs frontend-only: no new Home Assistant entities, high-frequency state history, WebSocket protocol extensions, or changes to the tested pulse/STOP watchdog.
- Share one lightweight ticker across visible devices, pause when hidden or disconnected, and stop redrawing when every history trace is flat.
- Refresh the bundled Lovelace resource to v0.1.9. All existing controls and device settings are preserved.

## 0.1.8 - Redundant pulse STOP watchdog
- Add a STOP safety net for every completed individual or all-device pulse: initial STOP, then five repeated STOP attempts at approximately +0.2, +2, +2.2, +10 and +10.2 seconds (measured from the first STOP completion).
- Repeat the native We-Vibe zero-output packet as well as the standard StopDeviceCmd for each backup if a native firmware pattern was active. A server acknowledgement alone does not cancel the backups.
- Every backup is bound to the original device generation, server session and command serial. New Run, Pulse, Stop, manual output or disabling Ogg cancels its older backups, so they cannot interrupt new activity. Disconnection discards the old-session watchdog; existing reconnect verification requires STOP before output resumes.
- Backup attempts run in background and use a per-device lock; dashboard controls remain responsive. An unreachable device cannot be stopped over a disconnected Bluetooth link, so this remains a best-effort safety net, not a hardware guarantee.
- No IntiHA change needed. Existing device names, server failover and HACS Control Deck remain unchanged.

## 0.1.7 - IntiHA connection recovery hotfix
- Keep the server WebSocket connected if one known Bluetooth device refuses a STOP while its connection is not yet ready. Only that device stays quarantined (`recovering`) until an acknowledged STOP succeeds.
- Retry failed device recovery on subsequent device-list refreshes, without losing the server, other connected devices, device settings, or the 30-second Ogg-owned Run/Pulse intention.
- Preserve strict STOP-before-resume. A device without an acknowledged STOP remains unavailable for output. Normal output-stop failures still close a potentially unsafe session.
- Report handshake errors separately from per-device recovery failures, and clear stale recovery warnings once all connected devices are verified.
- Refresh the bundled HACS dashboard-card resource version. No IntiHA engine update is necessary for this Ogg hotfix.

## 0.1.6 - server-agnostic recovery, identity and intensity
- Retain non-persistent desired Run/Pulse state during short (30-second maximum) disconnects, across different Intiface servers. Confirm STOP on the new session before resuming.
- Never extend pulse deadlines: only the remaining time is eligible for resumption. Explicit Stop, permission disable, Ogg Off, or expiry cancels the intent.
- Match Bluetooth devices by explicit MAC when the server supplies one, preserving entity identities/settings across changed server names and indices. Keep distinct MAC addresses separate.
- Add a device **Intensity** dropdown to the HACS-bundled Control Deck, displaying the current percentage and 10% increments (0% through 100%). Retain the current percentage if not on a 10% step.
- Fix first-use device Pulse actions; update the frontend resource version so browsers fetch the new card.

- Fix first-use per-device Pulse buttons in Control Deck when Home Assistant reports an unpressed button as `unknown`.
- On every new Ogg device session, cancel old runners, reset pulse/run state, issue a stop, and only permit new commands once recovery completes.
- Retain the HACS dashboard resource and settings shortcuts.

# Changelog

## 0.1.4

- Add settings gear links next to HA Server and Ogg in the Control Deck, opening the corresponding Home Assistant integration pages.
- Keep on/off controls independent; use in-app navigation on ordinary clicks with native browser fallback for modified clicks.
- Refresh the versioned Lovelace resource so HACS updates the bundled card.

## 0.1.3

- Bundle the mobile-first **Ogg Control Deck** dashboard card directly in the
  HACS Ogg integration. No separate dashboard plugin or `/config/www` copy.
- Serve the card from `/ogg/control-deck/ogg-control-deck-card.js` and
  automatically register a versioned Lovelace module in storage-mode dashboards.
- Register the card once per Ogg integration, not once per configured server,
  and update its resource URL on future releases without duplicating it.
- Load existing Lovelace resources before modifying them so unrelated
  dashboard cards are preserved.
- In YAML resource mode, expose the URL but leave resource configuration to
  the administrator. Frontend errors cannot prevent Ogg's engine loading.

## 0.1.2

- Add a persistent **Connect this device** switch to each known device. When off, regular output commands are blocked and any active output is stopped. Discovery and connection monitoring continue.
- Exclude disabled devices from global Run and Pulse all actions. Explicit Stop controls remain available for safety; a server-wide emergency stop may reach disabled devices.
- Add **Pulse duration (all devices)** to every device's entity page. All copies share the existing global pulse timer and update together. The original timer remains on the Ogg controller.
- Preserve existing device identity, aliases, and settings; default existing devices to allowed.


## 0.1.1

- Keep each device's Home Assistant identity when it moves to another server,
  IP address, configured address source or server-local device index.
- Preserve original device names, entity IDs and settings while routing commands
  to the current connection. Different advertised motor counts no longer create
  another device; temporarily unavailable motor settings are retained.
- Consolidate unambiguous duplicates saved by Ogg 0.1.0, retaining the first
  saved device and its settings. Remove redundant registry entries before
  loading entities. References to removed duplicate entities may need updating.
- Keep same-model devices with distinct, consistent server display names
  separate. Leave ambiguous identical devices separate rather than guessing.
- Add real Home Assistant regressions for cross-IP failover, changed indices,
  sensor-to-manual source changes, reloads, capability changes and upgrade
  migration. Discovery and reconnection continue without starting motors.

## 0.1.0

Initial Ogg release, rebuilt as a separate Home Assistant integration.

- Offline-friendly setup with connection and address sensors.
- Five fixed server addresses and five sensor-supplied addresses.
- Background discovery, reconnect and failover.
- Master enable, per-device run, timed pulse and grouped controls.
- Software patterns with intensity, cycle period and motor controls.
- Explicitly selected native patterns for supported classic We-Vibe models.
- Original device names, retained settings and redacted diagnostics.
- HACS repository structure, regression tests and validation workflows.

Physical-device acceptance testing is required before treating a release as
hardware-validated. The protocol and Home Assistant tests use simulated servers.
