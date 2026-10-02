# Reference-authored morphers

All eight morphers use the review bench's original dual-form illustrations and prompts.
The prompt owns anatomical weapon sides when an illustration reverses them.
Unseen rear surfaces, cavity depth and shield hardware are inferred.

[The morpher contract](../tools/mech_authoring/morphers.json) owns the component plan,
rig, rigid endpoint transforms and acceptance. It inherits project limits from the existing
asset contract. [The morpher recipe](../tools/mech_authoring/morph_recipe.py) consumes the
existing Blender builder and geometric utilities. Both registry forms consume one generated
mesh inventory; the flight wrapper cannot introduce another geometry source.

The existing morph solver derives motion from the two endpoint rigs. Stable joint/material
tags keep the same parts paired across the rig swap. Cape panels retain their dimensions.
Sealed hulls contain only the limbs explicitly listed as stowed by each contract.
Monkey and vampire limbs remain exposed; the raptor retains two hind talons in flight.
The whale keeps its tusks fixed and aligns its head, hull and tail along one axis.
The flying squirrel follows its individual prompt: exactly four exposed struts support
the patagium. The Atlas arms follow the wing leading edges as propulsion mounts.
Solid shield petals fold into the rotor ducts in flight. Bird primary and secondary
feathers overlap at their articulated roots; folded wings pack against the back
without changing scale.
Only the beetle membrane wings enter the flap driver; its elytra remain protective armor.

Animal load chains expose humerus, radius/ulna and metacarpal links separately from
femur, tibia/fibula and metatarsal links. Elbows point aft; stifles point forward and
raised calcaneal heels sit behind the hind ankle. Three driven distal joints preserve
the existing forelimb support curve and hindlimb spring curve through the complete chain.
The beetle attaches each leg pair to its corresponding thoracic segment and articulates
coxa, trochanter, femur, tibia, five tarsomeres and paired pretarsal claws. Coxal sweep
and lateral leg lift follow the alternating tripod phases. Its broad toothed front
tibiae differ from the middle and hind walking legs. The raptor carries a low elongated
skull on an S-shaped neck; a tapered horizontal tail has restrained distal movement.

Anatomical references: [Cambridge HE+ limb anatomy](https://myheplus.com/subject/veterinary-medicine/basic-veterinary-anatomy),
[AMNH insect segments](https://www.amnh.org/learn-teach/curriculum-collections/biodiversity-counts/arthropod-identification/arthropod-morphology/parts-of-an-insect-grasshopper),
[scarab leg attachment research](https://pmc.ncbi.nlm.nih.gov/articles/PMC4227028/),
and [NHM Velociraptor anatomy](https://www.nhm.ac.uk/discover/velociraptor-facts.html).

Shield deployment shares one presentation clock across both trees. Its mechanical post-pass
follows the interpolated transform without advancing that clock twice. The authored membrane
remains decorative; defense, shield points and collision remain server-owned.

Commands live in [package.json](../package.json). Editable Blender sources and review renders
live in `out/morph_reference/<id>/`; the GLB and runtime batches use the existing export seams.
[Source validation](../out/morph_reference/source-validation.json) reopens the editable file,
recovers actions and tests folded limb vertices against each authored hull profile.
[Runtime validation](../out/morph_reference/runtime-validation.json) exercises the shipped
registry, reversible transitions, fire/cast/shield motion, frame rates and independently loaded
GLB clips. Comparison sheets preserve original images alongside exact renders.
Visual approval remains a separate user review gate.
