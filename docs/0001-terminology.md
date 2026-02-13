# Terminology Decisions

This document records the domain terminology choices for Pick My Fruit, including reasoning and alternatives considered.

## Final Choices

| Concept                              | Model Name    | URL Pattern       | Reasoning                                                                                                                                                                      |
| ------------------------------------ | ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Canonical category of shareable item | `ProduceType` | `/produce/{slug}` | "Produce" is accurate, broadly understood, and covers fruits, vegetables, herbs, eggs, and honey. URL reads naturally. Model name explicitly includes "Type" for code clarity. |
| A specific shareable source          | `Listing`     | `/listings/{slug}` | Standard marketplace term; unambiguous in code. URL uses "listings" for clarity and consistency with model name. "Stand" reserved for future multi-produce farm stand concept. |
| A completed transfer                 | `Gathering`   | (TBD)             | Echoes French _cueillette_ (picking/gathering). Works for all fulfillment modes (pickup, delivery, porch drop). Community-oriented without implying transaction.               |

## Data Model Overview

```
ProduceType (system-managed, user-submittable)
    "Rangpur Lime", "Rosemary", "Chicken Eggs", "Wildflower Honey"
         │
         ▼
Listing (user-created, references a ProduceType)
    "James's Rangpur Lime Tree in Napa, ripe in February"
         │
         ▼
Gathering (records a transfer)
    "Bill picks up 3 limes on Feb 12"
```

## Alternatives Considered

### ProduceType

| Term       | Pros                      | Cons                                      | Verdict            |
| ---------- | ------------------------- | ----------------------------------------- | ------------------ |
| Produce    | Accurate, broad, good URL | "Is a produce" ungrammatical              | **Chosen for URL** |
| Variety    | Grammatically clean       | Awkward for eggs/honey                    | Rejected           |
| Crop       | Agricultural authenticity | Excludes eggs, honey                      | Rejected           |
| Item       | Universal                 | Generic, no personality                   | Rejected           |
| Product    | Works everywhere          | Commercial tone                           | Rejected           |
| Harvest    | Evocative                 | Noun/verb confusion; seasonal implication | Rejected           |
| Offering   | Warm, gift-oriented       | Conflates type with action                | Rejected           |
| Good/Goods | Extensible                | "Is a good" ungrammatical                 | Rejected           |
| Bounty     | Positive, abundant        | Whimsical; may not age well               | Rejected           |

### Listing

| Term     | Pros                         | Cons                                      | Verdict    |
| -------- | ---------------------------- | ----------------------------------------- | ---------- |
| Listing  | Standard, unambiguous        | Generic                                   | **Chosen** |
| Stand    | Charming, fits farm metaphor | Reserved for future multi-produce concept | Deferred   |
| Source   | Emphasizes recurring nature  | Abstract                                  | Rejected   |
| Share    | Community-oriented           | Noun form awkward; social media collision | Rejected   |
| Patch    | Casual, garden-y             | Odd for trees, animals                    | Rejected   |
| Offering | Warm                         | Better for the action than the entity     | Rejected   |

### Gathering

| Term      | Pros                                            | Cons                                     | Verdict    |
| --------- | ----------------------------------------------- | ---------------------------------------- | ---------- |
| Gathering | Community feel; works for all fulfillment modes | Slightly uncommon                        | **Chosen** |
| Pickup    | Clear, familiar                                 | Implies recipient travels                | Rejected   |
| Transfer  | Accurate                                        | Clinical, transactional                  | Rejected   |
| Harvest   | Thematic                                        | Implies grower's action, not recipient's | Rejected   |
| Exchange  | Neutral                                         | Implies bidirectionality                 | Rejected   |

## Cross-Language Analysis

Terms explored in Spanish, French, and Chinese to find inspiration beyond English defaults.

### Spanish

| Term      | Translation      | Notes                                |
| --------- | ---------------- | ------------------------------------ |
| Cosecha   | Harvest          | Warm, agricultural; universal appeal |
| Productos | Products         | Generic                              |
| Frutos    | Fruits (broader) | Includes "fruits of labor" metaphor  |
| Excedente | Surplus          | Accurate but clinical                |
| Donativo  | Donation         | Implies charity                      |
| Cultivo   | Crop             | Agricultural scale implied           |
| Tesoro    | Treasure         | Playful but too cute                 |

### French

| Term           | Translation       | Notes                                                      |
| -------------- | ----------------- | ---------------------------------------------------------- |
| Récolte        | Harvest           | Evocative, seasonal                                        |
| Partage        | Sharing           | Community emphasis                                         |
| **Cueillette** | Picking/Gathering | **Inspired "Gathering" choice**—action-focused, fits brand |
| Don            | Gift              | One-directional                                            |
| Offrande       | Offering          | Religious undertone                                        |
| Trésors        | Treasures         | Warm but whimsical                                         |

### Chinese

| Term     | Pinyin   | Translation                 | Notes                                                              |
| -------- | -------- | --------------------------- | ------------------------------------------------------------------ |
| 收获     | shōuhuò  | Harvest                     | Positive, earned                                                   |
| **土产** | tǔchǎn   | Local produce / Earth-goods | **Notable:** 土 = earth/soil; emphasizes ground-grown authenticity |
| 好物     | hǎowù    | Good stuff / Goodies        | Modern, trendy; may not age well                                   |
| 物产     | wùchǎn   | Products                    | Formal, governmental                                               |
| 分享     | fēnxiǎng | Share                       | Same social-media collision as English                             |
| 果实     | guǒshí   | Fruits/Results              | Broader than English "fruit"                                       |

### Key Insights

1. **Convergence on "Harvest"**: All three languages have strong, resonant words for harvest (cosecha/récolte/收获)—but English "harvest" has seasonal/noun-verb ambiguity
2. **French _cueillette_** directly inspired **Gathering**—emphasizes the act of coming to pick/collect
3. **Chinese 土产** (earth-goods) could inspire future branding around "ground-grown" authenticity
4. **好物** (goodies) reflects modern casual e-commerce tone—decided against for longevity
