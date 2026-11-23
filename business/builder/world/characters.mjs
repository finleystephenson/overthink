// The made-up customers: recognisable characters from works that are in the public domain worldwide
// (authors who died before 1955, or anonymous folklore, myth and legend). Never real people, never anything
// from modern films, television, comics or games. Left out on purpose because someone still holds rights somewhere:
// Peter Pan, A. A. Milne, Agatha Christie, P. G. Wodehouse, Tolkien, C. S. Lewis, Beatrix Potter, Disney versions,
// Tarzan, Zorro, Conan, and anything first published after 1926. Also left out: real people (so no kings or
// generals from the history plays) and living religions' gods.
//
// Format of CHARACTER_TEXT: "# Work" sets the source, "@ Place / Street" sets the fictional town and a default street,
// then one character per line: Name | address line (optional) | kind (optional).
// Kind letters: g = gift buyer, r = regular, x = returns a lot, c = complains, b = business buyer.
// A character with no kind letter gets one from a fixed hash of the name, so it never changes between builds.
//
// SECOND PASS RULE (used when a size needs more customers than the list holds): every character is used once.
// Then the list is used again with a relation in front of or behind the name, one relation per pass:
// "Count Dracula's neighbour", "A cousin of Count Dracula", "Count Dracula's lodger" ... After the last relation
// the cycle starts again with a roman numeral, e.g. "Count Dracula's neighbour II". Every result is unique because
// the base names are unique. The relation's address line is derived from the original ("Next door to ...").
import { hashString } from "./rng.mjs";

export const CHARACTER_TEXT = `
# Hamlet
@ Elsinore / Castle Walk
Hamlet | The Battlements, Elsinore Castle | g
Claudius | The Royal Apartments, Elsinore Castle
Gertrude | The Queen's Closet, Elsinore Castle
Ophelia | The Willow Bank, Elsinore
Polonius | Behind the Arras, Elsinore Castle | c
Laertes | 3 Castle Walk
Horatio | The Guardroom, Elsinore Castle | r
Rosencrantz
Guildenstern
Fortinbras | The Norwegian Camp, Elsinore | g
Osric | Court Lodgings, Elsinore
# Romeo and Juliet
@ Verona / Via Cappello
Juliet Capulet | The Balcony Flat, Via Cappello | r
Romeo Montague | Orchard Wall, Via Montecchi
Tybalt Capulet | The Gatehouse, Via Scala | c
Mercutio | 9 Via Cappello
Benvolio | 14 Via Montecchi
Friar Laurence | The Cell, San Zeno Lane
Count Paris | Palazzo Paris, Via Cappello
Rosaline | 21 Via Scala
# Twelfth Night
@ Illyria / Sea Road
Viola | The Harbour Steps, Illyria
Duke Orsino | The Duke's Palace, Illyria | r
Countess Olivia | Olivia's House, Illyria
Malvolio | The Steward's Lodge, Olivia's House | c
Sir Toby Belch | The Cellar Door, Olivia's House
Sir Andrew Aguecheek | 4 Sea Road
Feste | The Fool's Bench, Illyria
Maria | The Housekeeper's Room, Olivia's House
Sebastian | 12 Sea Road
# The Merchant of Venice and Othello
@ Venice / Rialto Quay
Antonio | The Warehouse, Rialto Quay | b
Portia | Belmont House, Rialto Quay
Bassanio | 6 Rialto Quay
Gratiano | 8 Rialto Quay
Nerissa | Belmont House Servants' Wing
Jessica | 15 Ghetto Lane
Lorenzo | 17 Ghetto Lane
Othello | The Moorish Quarter, Rialto Quay | x
Desdemona | 2 Handkerchief Row
Iago | 5 Handkerchief Row | c
Cassio | 11 Rialto Quay
Emilia | 3 Handkerchief Row
Bianca | 19 Rialto Quay
# As You Like It
@ Forest of Arden / Oak Path
Rosalind | The Cottage, Oak Path
Orlando | The Wrestling Green, Forest of Arden
Celia | Oak Path Cottage
Touchstone | The Clown's Wagon, Forest of Arden
Jaques | The Melancholy Bough, Forest of Arden | c
Audrey | 3 Oak Path
Corin | The Shepherd's Hut, Oak Path
Silvius | 7 Oak Path
Phebe | 9 Oak Path
# A Midsummer Night's Dream
@ Athens Wood / Moonlit Lane
Puck | The Mushroom Ring, Athens Wood
Oberon | The Royal Bower, Athens Wood
Titania | The Bank of Wild Thyme, Athens Wood
Nick Bottom | The Weaver's Loft, Moonlit Lane | b
Peter Quince | The Carpenter's Shop, Moonlit Lane | b
Francis Flute | 3 Moonlit Lane
Tom Snout | The Tinker's Yard, Moonlit Lane
Snug the Joiner | 5 Moonlit Lane
Robin Starveling | The Tailor's Shop, Moonlit Lane
Hermia | 12 Moonlit Lane
Helena | 14 Moonlit Lane
Lysander | 16 Moonlit Lane
Demetrius | 18 Moonlit Lane
Hippolyta | The Palace Gardens, Athens Wood
Peaseblossom | A Fern Bed, Athens Wood
# Macbeth
@ Dunsinane / Heath Road @HI
Macbeth | Dunsinane Castle | r
Lady Macbeth | The Spare Room, Dunsinane Castle | c
Banquo | The Banquet Hall, Dunsinane Castle
Macduff | Fife Cottage, Heath Road
Lady Macduff | Fife Cottage, Heath Road
Fleance | 4 Heath Road
Malcolm | The Tower, Heath Road
Donalbain | 6 Heath Road
Hecate | The Blasted Heath
# The Tempest
@ Prospero's Island / Shore Path @HI
Prospero | The Cell, Prospero's Island | r
Miranda | The Cave Mouth, Prospero's Island
Ariel | The Pine Tree, Prospero's Island
Caliban | The Rocky Shore, Prospero's Island | c
Ferdinand | The Log Pile, Prospero's Island
Gonzalo | The Lime Grove, Prospero's Island
Trinculo | A Wet Bush, Prospero's Island
Stephano | The Wine Barrel, Prospero's Island
# King Lear
@ Lear's Britain / High Road
King Lear | The Heath, Lear's Britain | c
Cordelia | 2 High Road
Goneril | Albany Castle, Lear's Britain
Regan | Cornwall Castle, Lear's Britain
Edgar | A Hovel, Lear's Britain
Edmund | Gloucester Castle, Lear's Britain
Earl of Gloucester | Gloucester Castle, Lear's Britain
Earl of Kent | 8 High Road
# Falstaff and others
@ Windsor Wood / Garter Lane
Sir John Falstaff | The Garter Inn, Garter Lane | c
Mistress Quickly | The Boar's Head, Garter Lane | b
Mistress Ford | 3 Garter Lane
Mistress Page | 5 Garter Lane
Master Ford | 7 Garter Lane
Master Page | 9 Garter Lane
Anne Page | 11 Garter Lane
Bardolph | The Red Nose Tavern, Garter Lane
Pistol | 13 Garter Lane
Doll Tearsheet | 15 Garter Lane
Justice Shallow | The Manor House, Windsor Wood
# Much Ado, Shrew, and other comedies
@ Messina / Harbour Street
Beatrice | The Governor's House, Harbour Street | r
Benedick | 4 Harbour Street | r
Hero | 6 Harbour Street
Claudio | 8 Harbour Street
Dogberry | The Watch House, Harbour Street | c
Don Pedro | The Prince's Lodging, Harbour Street
Don John | 10 Harbour Street
Petruchio | The Shrew House, Harbour Street
Katherina Minola | 12 Harbour Street | x
Lucentio | 14 Harbour Street
Grumio | 16 Harbour Street
Isabella | The Convent, Harbour Street
Duke Vincentio | The Palace, Harbour Street
Angelo | 18 Harbour Street
Berowne | 20 Harbour Street
Costard | The Dairy, Harbour Street
Don Armado | 22 Harbour Street
Antipholus of Ephesus | 24 Harbour Street
Dromio of Syracuse | 26 Harbour Street
Proteus | 28 Harbour Street
Valentine | 30 Harbour Street
Launce | The Dog Kennel, Harbour Street
Troilus | 32 Harbour Street
Cressida | 34 Harbour Street
Pandarus | 36 Harbour Street
# The Winter's Tale, Cymbeline and other late plays
@ Bohemia / Shepherd's Hill
Leontes | The Sicilian Court, Bohemia
Hermione | The Statue Garden, Bohemia
Perdita | The Sheep-Shearing Meadow, Shepherd's Hill
Florizel | 5 Shepherd's Hill
Paulina | The Chapel House, Bohemia
Autolycus | A Peddler's Cart, Shepherd's Hill | c
Polixenes | 7 Shepherd's Hill
Imogen | The Cave, Shepherd's Hill
Posthumus Leonatus | 9 Shepherd's Hill
Pericles | The Ship's Deck, Shepherd's Hill
Titus Andronicus | The Pie Shop, Shepherd's Hill
Timon of Athens | The Cave by the Sea, Shepherd's Hill | c

# Dickens: Pickwick Papers
@ Dingley Dell / Manor Farm Road
Mr Pickwick | The Pickwick Club, Manor Farm Road | r
Sam Weller | The Boot Room, Manor Farm Road | r
Mr Winkle | 3 Manor Farm Road
Mr Snodgrass | 5 Manor Farm Road
Mr Tupman | 7 Manor Farm Road
Alfred Jingle | A Coaching Inn, Manor Farm Road | c
Mrs Bardell | The Lodging House, Manor Farm Road | b
Mr Wardle | Manor Farm, Dingley Dell
# Dickens: Oliver Twist
@ Saffron Hill / Field Lane
Oliver Twist | The Workhouse Dining Hall, Field Lane | g
The Artful Dodger | 9 Field Lane
Bill Sikes | 11 Field Lane | c
Nancy | 13 Field Lane
Mr Bumble | The Parish Office, Field Lane | b
Mr Brownlow | Pentonville Cottage, Field Lane
Mr Sowerberry | The Undertaker's, Field Lane | b
Charley Bates | 15 Field Lane
Mrs Corney | The Workhouse Matron's Room, Field Lane
# Dickens: David Copperfield
@ Blunderstone / Rookery Road
David Copperfield | The Rookery, Blunderstone | r
Mr Micawber | Something Will Turn Up Cottage, Rookery Road | c
Mrs Micawber | Something Will Turn Up Cottage, Rookery Road
Uriah Heep | The Law Office, Rookery Road | c
Betsey Trotwood | The Donkey-Free Lawn, Dover Cliffs
Mr Peggotty | The Upturned Boat, Yarmouth Sands | r
Agnes Wickfield | 3 Rookery Road
James Steerforth | 5 Rookery Road
Dora Spenlow | 7 Rookery Road
Mr Barkis | The Carrier's Cart, Rookery Road | b
Mr Dick | 9 Rookery Road
Edward Murdstone | 11 Rookery Road | c
Tommy Traddles | 13 Rookery Road
Mr Creakle | The Schoolhouse, Rookery Road
# Dickens: Great Expectations
@ Satis Marsh / Forge Lane
Pip | The Forge, Forge Lane | g
Estella | Satis House Garden, Satis Marsh
Miss Havisham | Satis House, Satis Marsh | x
Abel Magwitch | The Hulks, Satis Marsh
Joe Gargery | The Forge, Satis Marsh | b
Mr Jaggers | The Law Offices, Little Britain | b
John Wemmick | The Castle, Walworth Lane | r
Herbert Pocket | 4 Forge Lane
Biddy | 6 Forge Lane
Uncle Pumblechook | The Corn Merchant's, Forge Lane | b
Bentley Drummle | 8 Forge Lane
# Dickens: A Christmas Carol
@ Cornhill / Counting House Court
Ebenezer Scrooge | Scrooge and Marley, Counting House Court | b
Bob Cratchit | Scrooge and Marley's Counting House, Cornhill | b
Tiny Tim | 15 Bayham Street | g
Jacob Marley | The Knocker, Counting House Court
Mr Fezziwig | Fezziwig's Warehouse, Counting House Court | b
Mrs Cratchit | 15 Bayham Street
Fred Scrooge | 6 Counting House Court
# Dickens: Nicholas Nickleby
@ Dotheboys Hall / Yorkshire Road
Nicholas Nickleby | The Coach Stop, Yorkshire Road
Smike | The Back Room, Dotheboys Hall
Ralph Nickleby | The Money-Lender's Office, Golden Square
Wackford Squeers | Dotheboys Hall | c
Newman Noggs | 4 Golden Square
Kate Nickleby | 6 Golden Square
Mr Mantalini | The Dressmaker's, Golden Square | b
Charles Cheeryble | Cheeryble Brothers' Office, Golden Square | b
Mrs Nickleby | 8 Golden Square
# Dickens: The Old Curiosity Shop
@ Curiosity Court / Lincoln Fields
Little Nell | The Old Curiosity Shop, Curiosity Court
Daniel Quilp | The Wharf, Curiosity Court | c
Dick Swiveller | 3 Lincoln Fields
Kit Nubbles | 5 Lincoln Fields
The Marchioness | The Cellar, Curiosity Court
# Dickens: Hard Times
@ Coketown / Gradgrind Row
Thomas Gradgrind | Stone Lodge, Coketown | b
Josiah Bounderby | The Bank, Coketown | c
Sissy Jupe | 4 Gradgrind Row
Louisa Gradgrind | Stone Lodge, Gradgrind Row
Stephen Blackpool | The Mill Yard, Coketown
# Dickens: A Tale of Two Cities
@ Soho Square / Manette Court
Sydney Carton | The Lawyer's Chambers, Manette Court
Charles Darnay | 3 Manette Court
Lucie Manette | The Golden Thread House, Manette Court
Dr Manette | The Cobbler's Bench, Manette Court
Madame Defarge | The Wine Shop, Saint Antoine
Jerry Cruncher | The Odd-Job Yard, Manette Court | b
Miss Pross | 5 Manette Court
# Dickens: Bleak House
@ Chesney Wold / Chancery Lane
Esther Summerson | Bleak House, Chancery Lane
Lady Dedlock | Chesney Wold | c
Mr Tulkinghorn | The Law Chambers, Chancery Lane | b
Inspector Bucket | The Police Office, Chancery Lane
Mrs Jellyby | Telescopic Philanthropy House, Chancery Lane | c
Harold Skimpole | 7 Chancery Lane
John Jarndyce | Bleak House | r
Mr Krook | The Rag and Bottle Shop, Chancery Lane | b
Mr Guppy | The Solicitor's Clerk's Desk, Chancery Lane
# Dickens: Little Dorrit, Our Mutual Friend and others
@ Marshalsea / Borough High Street
Amy Dorrit | The Marshalsea Lodge, Borough High Street
William Dorrit | The Marshalsea, Borough High Street
Arthur Clennam | The Counting House, Borough High Street | b
Mr Merdle | The Great Bank, Borough High Street | b
Flora Finching | 12 Borough High Street
Mr Pancks | 14 Borough High Street | b
Mr Meagles | 16 Borough High Street
Mr Venus | Venus's Taxidermy Shop | b
Silas Wegg | The Ballad Stall, Borough High Street | b
Noddy Boffin | Boffin's Bower, Borough High Street
Bella Wilfer | 18 Borough High Street
Jenny Wren | The Doll's Dressmaking Room, Borough High Street | b
Lizzie Hexam | 20 Borough High Street
Eugene Wrayburn | 22 Borough High Street
Mr Podsnap | 24 Borough High Street | c
Martin Chuzzlewit | 26 Borough High Street
Mrs Gamp | 28 Borough High Street | b
Seth Pecksniff | The Architect's Office, Borough High Street | b
Mark Tapley | 30 Borough High Street
Tom Pinch | 32 Borough High Street
Paul Dombey | Dombey and Son, Borough High Street | b
Florence Dombey | 34 Borough High Street
Captain Cuttle | The Wooden Midshipman, Borough High Street
Mr Toots | 36 Borough High Street
Major Bagstock | 38 Borough High Street
Edwin Drood | The Cloisterham Lodge, Borough High Street
John Jasper | The Choirmaster's House, Cloisterham
Rosa Bud | 40 Borough High Street
John Peerybingle | The Carrier's Cottage, Borough High Street | b
Dot Peerybingle | The Hearth, Borough High Street

# Jane Austen
@ Longbourn / Meryton Road
Elizabeth Bennet | Longbourn House, Meryton Road | r
Mr Darcy | Pemberley, Derbyshire Hill | g
Jane Bennet | Longbourn House, Meryton Road
Mrs Bennet | The Morning Room, Longbourn House | c
Mr Bennet | The Library, Longbourn House
Lydia Bennet | 4 Meryton Road | x
Kitty Bennet | 6 Meryton Road
Mary Bennet | The Pianoforte, Longbourn House
Mr Bingley | Netherfield Park, Meryton Road | r
Caroline Bingley | Netherfield Park, Meryton Road
Mr Collins | Hunsford Parsonage, Meryton Road | c
Charlotte Lucas | Lucas Lodge, Meryton Road
Lady Catherine de Bourgh | Rosings Park, Meryton Road | c
George Wickham | 8 Meryton Road | x
@ Highbury / Hartfield Lane
Emma Woodhouse | Hartfield, Highbury | r
Mr Knightley | Donwell Abbey, Highbury
Harriet Smith | Mrs Goddard's School, Highbury
Mr Woodhouse | Hartfield, Highbury | c
Frank Churchill | 3 Hartfield Lane
Jane Fairfax | 5 Hartfield Lane
Miss Bates | Over the Baker's, Highbury | c
Mr Elton | The Vicarage, Highbury
@ Barton Cottage / Norland Road
Elinor Dashwood | Barton Cottage | r
Marianne Dashwood | Barton Cottage
Colonel Brandon | Delaford House, Norland Road
John Willoughby | Combe Magna, Norland Road | x
Edward Ferrars | 3 Norland Road
Lucy Steele | 5 Norland Road
Anne Elliot | Kellynch Hall, Norland Road
Captain Wentworth | The Admiral's Lodging, Norland Road | r
Sir Walter Elliot | Kellynch Hall, Norland Road | c
Fanny Price | Mansfield Park, Norland Road
Edmund Bertram | Mansfield Parsonage, Norland Road
Mary Crawford | 7 Norland Road
Catherine Morland | Northanger Abbey, Norland Road
Henry Tilney | Woodston Parsonage, Norland Road
Isabella Thorpe | 9 Norland Road
General Tilney | Northanger Abbey, Norland Road | c

# The Brontes
@ Thornfield / Moor Road
Jane Eyre | Thornfield Hall, Moor Road | r
Mr Rochester | Thornfield Hall, Moor Road
St John Rivers | Moor House, Moor Road
Helen Burns | Lowood School, Moor Road
Mrs Fairfax | The Housekeeper's Room, Thornfield Hall
Adele Varens | 3 Moor Road
Mrs Reed | Gateshead Hall, Moor Road | c
@ Wuthering Heights / Gimmerton Moor
Heathcliff | Wuthering Heights | c
Catherine Earnshaw | The Window Seat, Wuthering Heights
Edgar Linton | Thrushcross Grange, Gimmerton Moor
Isabella Linton | Thrushcross Grange, Gimmerton Moor
Hindley Earnshaw | Wuthering Heights | x
Nelly Dean | The Kitchen, Thrushcross Grange | r
Mr Lockwood | Thrushcross Grange, Gimmerton Moor
Hareton Earnshaw | Wuthering Heights
@ Villette / Rue Fossette
Lucy Snowe | Madame Beck's School, Rue Fossette
Paul Emanuel | 3 Rue Fossette
Shirley Keeldar | Fieldhead, Rue Fossette
Helen Graham | Wildfell Hall, Rue Fossette
Gilbert Markham | Linden-Car Farm, Rue Fossette
Agnes Grey | The Governess's Room, Rue Fossette

# Sherlock Holmes (stories published before 1927)
@ London / Baker Street BK
Sherlock Holmes | 221B Baker Street | r
Dr Watson | The Upstairs Rooms, Baker Street | r
Mrs Hudson | 221 Baker Street, The Ground Floor | b
Professor Moriarty | A Study, Reichenbach Falls | x
Mycroft Holmes | The Diogenes Club, Pall Mall | b
Inspector Lestrade | Scotland Yard, Whitehall
Irene Adler | Briony Lodge, Serpentine Avenue | g
Colonel Moran | 14 Baker Street
Sir Henry Baskerville | Baskerville Hall, Dartmoor
Dr Mortimer | Grimpen Surgery, Dartmoor
Jack Stapleton | Merripit House, Dartmoor
Mary Morstan | 3 Camberwell Road
Inspector Gregson | 7 Baker Street
Jabez Wilson | The Pawnbroker's, Coburg Square | b
Violet Hunter | The Copper Beeches, Hampshire
Grimesby Roylott | Stoke Moran Manor, Surrey | c
Helen Stoner | Stoke Moran Manor, Surrey
@ The Lost World / Plateau Road
Professor Challenger | Enmore Gardens, Kensington | c
Lord John Roxton | The Albany, Piccadilly
Edward Malone | The Gazette Office, Fleet Street
Professor Summerlee | 4 Plateau Road
@ Napoleonic France / Hussar Lane
Brigadier Gerard | The Hussar Barracks, Hussar Lane

# Alice in Wonderland and Through the Looking-Glass
@ Wonderland / Rabbit Hole Lane WL
Alice | The Bottom of the Rabbit Hole | g
The White Rabbit | The White Rabbit's House, Rabbit Hole Lane | b
The Mad Hatter | The Tea Table, Rabbit Hole Lane | c
The March Hare | The Tea Table, Rabbit Hole Lane
The Dormouse | The Teapot, Rabbit Hole Lane
The Cheshire Cat | The Tree Branch, Rabbit Hole Lane
Queen of Hearts | The Croquet Ground, Wonderland | c
King of Hearts | The Court Room, Wonderland
Knave of Hearts | The Tart Table, Wonderland | x
The Duchess | The Pepper Kitchen, Wonderland | c
The Caterpillar | The Mushroom, Wonderland
The Mock Turtle | The Shore, Wonderland
The Gryphon | The Sunny Rock, Wonderland
The Dodo | The Caucus Race Track, Wonderland
Bill the Lizard | The Chimney, Rabbit Hole Lane
@ The Looking-Glass House / Chessboard Square
Tweedledum | 1 Chessboard Square
Tweedledee | 2 Chessboard Square
Humpty Dumpty | The Wall, Chessboard Square | x
The Red Queen | Square Eight, Chessboard Square
The White Queen | Square Five, Chessboard Square
The White Knight | The Horse Stable, Chessboard Square
The Walrus | The Oyster Beach, Chessboard Square
The Carpenter | The Oyster Beach, Chessboard Square

# Robert Louis Stevenson
@ Bristol / Quayside
Long John Silver | The Spyglass Inn, Bristol Quayside | b
Jim Hawkins | The Admiral Benbow Inn, Bristol Quayside | g
Squire Trelawney | Trelawney Hall, Bristol Quayside
Dr Livesey | The Surgery, Bristol Quayside
Ben Gunn | The Cave, Skeleton Island
Billy Bones | The Admiral Benbow Inn, Bristol Quayside | c
Blind Pew | The Roadside, Bristol Quayside
Captain Smollett | The Hispaniola, Bristol Quayside | b
@ Soho / Queen Anne Street
Dr Jekyll | The Cabinet Door, Queen Anne Street | r
Mr Hyde | The Back Door, Queen Anne Street | x
Mr Utterson | The Lawyer's Office, Queen Anne Street | b
Dr Lanyon | 4 Queen Anne Street
@ Shaws Country / Heather Road
David Balfour | The House of Shaws, Heather Road

# Jules Verne
@ Twenty Thousand Leagues / Deck
Captain Nemo | The Nautilus | r
Professor Aronnax | The Nautilus Library
Ned Land | The Harpoon Locker, The Nautilus | c
Conseil | The Nautilus Pantry
@ Savile Row / Around the World
Phileas Fogg | 7 Savile Row | r
Passepartout | The Servant's Room, 7 Savile Row | r
Detective Fix | The Suez Quay, Savile Row
Princess Aouda | 3 Savile Row
@ The Centre of the Earth / Volcano Road
Professor Lidenbrock | The Hamburg Study, Volcano Road | c
Axel Lidenbrock | The Hamburg Attic, Volcano Road
Hans Bjelke | The Icelandic Farm, Volcano Road
@ The Moon Gun Club / Baltimore Wharf
Michel Ardan | The Columbiad Barrel, Baltimore Wharf
Impey Barbicane | The Gun Club, Baltimore Wharf | b
Captain Nicholl | The Armour Plate Works, Baltimore Wharf | b
@ Lincoln Island / Granite House @HI
Cyrus Smith | Granite House
Gideon Spilett | The Reporter's Hut
Pencroft | The Sailor's Cabin
@ The Albatross / Flying Fortress
Robur | The Albatross, High Above Philadelphia

# H. G. Wells
@ Iping / Coach and Horses Lane
The Invisible Man | The Coach and Horses, Iping | x
@ Moreau's Island / House of Pain Road @HI
Dr Moreau | The House of Pain, Moreau's Island
Edward Prendick | The Lifeboat Shore, Moreau's Island
@ Richmond / Time Machine Lane
The Time Traveller | The Laboratory, Time Machine Lane | r
@ Bromley / Wheels Road
Mr Polly | The Potwell Inn, Wheels Road | r
Arthur Kipps | The Draper's Counter, Wheels Road | b
Mr Hoopdriver | 3 Wheels Road
Mr Cavor | The Gravity Workshop, Wheels Road
Bert Smallways | The Cycle Shop, Wheels Road | b

# Mary Shelley
@ Geneva / Lake Road
Victor Frankenstein | The Laboratory, Lake Road | r
Elizabeth Lavenza | Frankenstein House, Lake Road
Henry Clerval | 3 Lake Road
Captain Walton | The Arctic Ship, Lake Road
Frankenstein's Monster | The Ice Hut, Lake Road | x

# Bram Stoker
@ Transylvania / Borgo Pass
Count Dracula | Castle Dracula, Borgo Pass | r
Jonathan Harker | The Solicitor's Office, Exeter | b
Mina Harker | 4 Crescent Road, Whitby
Lucy Westenra | Hillingham House, Hampstead
Dr Van Helsing | The Amsterdam Surgery, Borgo Pass
Dr Seward | The Purfleet Asylum, Hampstead | b
Renfield | A Padded Cell, Purfleet Asylum | c
Quincey Morris | The Texan Ranch, Borgo Pass
Arthur Holmwood | Ring Hall, Hampstead

# Alexandre Dumas
@ Paris / Rue Ferou
D'Artagnan | The Musketeers' Barracks, Rue Ferou | r
Athos | 1 Rue Ferou
Porthos | 2 Rue Ferou | c
Aramis | 3 Rue Ferou
Milady de Winter | The Hotel de Winter, Rue Ferou | x
Constance Bonacieux | The Haberdasher's, Rue Ferou | b
Planchet | The Servants' Stairs, Rue Ferou
@ Chateau d'If / Marseille Quay
Count of Monte Cristo | The Island Treasure Cave, Marseille Quay | g
Mercedes Herrera | 5 Marseille Quay
Baron Danglars | The Bank, Marseille Quay | b
Fernand Mondego | 7 Marseille Quay
Abbe Faria | Cell Twenty-Seven, Chateau d'If
Haydee | 9 Marseille Quay
Valentine de Villefort | 11 Marseille Quay
Maximilien Morrel | The Shipping Office, Marseille Quay | b
Albert de Morcerf | 13 Marseille Quay

# Victor Hugo
@ Paris Sewers / Rue Plumet
Jean Valjean | The Candlestick House, Rue Plumet | r
Inspector Javert | The Police Post, Rue Plumet | c
Cosette | 5 Rue Plumet
Fantine | 7 Rue Plumet
Marius Pontmercy | The Garret, Rue Plumet
Eponine | The Garden Railings, Rue Plumet
Gavroche | The Elephant of the Bastille, Rue Plumet
Enjolras | The Barricade, Rue Plumet
Bishop Myriel | The Bishop's House, Rue Plumet
@ Notre-Dame / Cathedral Square
Quasimodo | The Bell Tower, Notre-Dame
Esmeralda | The Courtyard of Miracles, Cathedral Square
Claude Frollo | The Cathedral Cell, Notre-Dame
Captain Phoebus | The Guard Barracks, Cathedral Square

# Cervantes
@ La Mancha / Windmill Track
Don Quixote | The Lance Rack, La Mancha | r
Sancho Panza | The Donkey Stable, La Mancha | r
Dulcinea | The Farm at El Toboso, La Mancha
Rocinante | The Stable, Windmill Track
Cardenio | The Sierra Morena, La Mancha

# Homer and the Greek myths
@ Ithaca / Olive Grove Road
Odysseus | The Palace of Ithaca | r
Penelope | The Loom Room, The Palace of Ithaca
Telemachus | 3 Olive Grove Road
Eumaeus | The Swineherd's Hut, Olive Grove Road
@ Troy / Scaean Gate Street
Achilles | The Tent by the Ships, Scaean Gate Street | c
Hector | The Citadel, Troy
Andromache | The Citadel, Troy
Priam | The King's Hall, Troy
Hecuba | The Queen's Hall, Troy
Cassandra | The Temple Steps, Troy | c
Helen of Troy | The Tower, Troy
Menelaus | 5 Scaean Gate Street
Agamemnon | The Command Tent, Scaean Gate Street
Ajax the Great | The Shield Works, Scaean Gate Street
Diomedes | 7 Scaean Gate Street
King Nestor | 9 Scaean Gate Street
Patroclus | The Armour Tent, Scaean Gate Street
@ Mount Olympus / Cloud Terrace
Zeus | The Throne Room, Mount Olympus | r
Hera | The Queen's Chamber, Mount Olympus | c
Poseidon | The Sea Palace, Cloud Terrace
Athena | The Owl House, Mount Olympus | r
Apollo | The Sun Temple, Mount Olympus
Artemis | The Moon Lodge, Mount Olympus
Ares | The War Room, Mount Olympus | x
Aphrodite | The Seashell Villa, Cloud Terrace
Hephaestus | The Forge, Mount Olympus | b
Hermes | The Messenger's Office, Mount Olympus | b
Demeter | The Granary, Cloud Terrace
Dionysus | The Vineyard Terrace, Cloud Terrace
Hades | The Underworld Gate, Cloud Terrace
Persephone | The Spring Garden, Cloud Terrace
Pan | The Pipes Meadow, Cloud Terrace
Eros | 3 Cloud Terrace
@ Hellas / Marble Street
Orpheus | The Lyre Shop, Marble Street
Eurydice | 3 Marble Street
Heracles | The Lion Skin Lodge, Marble Street | r
Theseus | The Labyrinth Entrance, Marble Street
Ariadne | The Thread Shop, Marble Street | b
Perseus | The Shield Shop, Marble Street
Andromeda | The Sea Rock, Marble Street
Jason | The Argo Dock, Marble Street | r
Medea | 5 Marble Street | x
Atalanta | The Racetrack, Marble Street
Narcissus | The Pool, Marble Street
King Midas | The Golden Palace, Marble Street
Icarus | The Wax Cliff, Marble Street
Daedalus | The Workshop, Marble Street | b
Oedipus | The Crossroads, Marble Street
Antigone | 7 Marble Street
Electra | 9 Marble Street
Orestes | 11 Marble Street
Pandora | The Box Room, Marble Street | x
Prometheus | The Rock, Marble Street
Sisyphus | The Hill Top, Marble Street
Bellerophon | The Stables, Marble Street
Arachne | The Weaver's Loft, Marble Street | b
Psyche | 13 Marble Street
Pygmalion | The Sculptor's Studio, Marble Street | b
Circe | The Island House, Marble Street
Calypso | The Cave Island, Marble Street
Polyphemus | The Sheep Cave, Marble Street
Nausicaa | The Laundry Shore, Marble Street
Penthesilea | 15 Marble Street
@ Carthage and Latium / Via Lavinia
Aeneas | The Beach House, Via Lavinia
Dido | The Queen's Palace, Carthage
Romulus | The Palatine Hut, Via Lavinia
Remus | The Aventine Hut, Via Lavinia

# Norse and Germanic legend
@ Asgard / Rainbow Bridge Road
Odin | The Great Hall, Asgard | r
Thor | The Hammer Hall, Asgard | r
Loki | The Back Room, Asgard | x
Freya | The Cat Carriage Barn, Asgard
Frigg | The Queen's Hall, Asgard
Baldur | The Mistletoe Grove, Asgard
Tyr | The Wolf Pit, Asgard
Heimdall | The Bridge Watch, Rainbow Bridge Road | b
Sif | The Golden Hair Salon, Asgard | b
Idun | The Apple Orchard, Asgard
Bragi | The Poet's Seat, Asgard
Njord | The Harbour, Asgard
Freyr | The Boar Barn, Asgard
Hel | The Cold Hall, Asgard
Fenrir | The Chain Rock, Asgard
@ The Rhine / Dragon's Path
Sigurd | The Dragon Pit, Dragon's Path | r
Brynhild | The Ring of Fire, Dragon's Path
Gudrun | 3 Dragon's Path
Siegfried | The Lime Tree, Dragon's Path
Kriemhild | 5 Dragon's Path
Hagen | 7 Dragon's Path | c
Gunther | The Burgundian Hall, Dragon's Path
Fafnir | The Gold Cave, Dragon's Path

# The Matter of Britain (Arthurian legend)
@ Camelot / Round Table Lane
King Arthur | The Round Table, Camelot | r
Queen Guinevere | The Queen's Chamber, Camelot
Sir Lancelot | The Lakeside Tower, Camelot
Merlin | The Crystal Cave, Camelot | b
Morgan le Fay | Avalon Cottage, Camelot | x
Sir Galahad | The Siege Perilous, Camelot
Sir Gawain | The Green Chapel Road, Camelot | r
Sir Percival | The Grail Castle Lane, Camelot
Sir Tristan | The Cornish Shore, Camelot
Isolde | The Love Potion Cottage, Camelot
Mordred | The Last Battlefield, Camelot | c
Sir Kay | The Castle Kitchens, Camelot | c
Sir Bedivere | The Lake Shore, Camelot
Lady of the Lake | The Lake Floor, Camelot
Sir Bors | 3 Round Table Lane
Sir Lamorak | 5 Round Table Lane
Sir Gareth | The Kitchens Below, Camelot
Sir Ector | The Foster Father's House, Camelot
Nimue | The Enchanted Pool, Camelot
Elaine of Astolat | The Tower, Shalott Island
The Lady of Shalott | The Loom Tower, Shalott Island
The Green Knight | The Green Chapel, Camelot
Sir Pellinore | The Questing Beast Lodge, Camelot
Morgause | 7 Round Table Lane
Sir Agravain | 9 Round Table Lane
Sir Lionel | 11 Round Table Lane
The Fisher King | The Wounded Hall, Camelot

# Robin Hood
@ Sherwood Forest / Greenwood Path SF
Robin Hood | The Major Oak, Sherwood Forest | r
Maid Marian | The Hidden Glade, Sherwood Forest
Little John | The Quarterstaff Bridge, Sherwood Forest | r
Friar Tuck | The Hermitage, Sherwood Forest | b
Will Scarlet | 3 Greenwood Path
Much the Miller's Son | The Mill, Greenwood Path | b
Alan-a-Dale | The Minstrel's Rock, Sherwood Forest
The Sheriff of Nottingham | Nottingham Castle, Greenwood Path | c
Guy of Gisborne | 5 Greenwood Path
Will Stutely | 7 Greenwood Path
David of Doncaster | 9 Greenwood Path

# Grimm, Perrault and other fairy tales
@ The Fairy-Tale Forest / Gingerbread Lane FT
Cinderella | The Hearth, Gingerbread Lane | g
Snow White | The Seven Beds Cottage, Gingerbread Lane
Little Red Riding Hood | The Cottage Path, Gingerbread Lane | g
Hansel | The Gingerbread House, Gingerbread Lane
Gretel | The Gingerbread House, Gingerbread Lane | g
Rapunzel | The Tower, Fairy-Tale Forest
Rumpelstiltskin | The Spinning Hut, Fairy-Tale Forest | x
Sleeping Beauty | The Tower Bed, Fairy-Tale Forest
Puss in Boots | The Miller's Cottage, Gingerbread Lane | r
Goldilocks | The Three Bears' Cottage, Gingerbread Lane | x
The Frog Prince | The Pond, Gingerbread Lane
Tom Thumb | The Mouse Hole, Gingerbread Lane
Jack of the Beanstalk | The Beanstalk Cottage, Gingerbread Lane | g
The Brave Little Tailor | The Tailor's Window, Gingerbread Lane | b
Rose Red | 3 Gingerbread Lane
The Pied Piper | The Town Hall Steps, Hamelin
The Goose Girl | The Goose Meadow, Fairy-Tale Forest
The Princess and the Pea | The Twenty Mattress Bed, Fairy-Tale Forest | c
The Twelve Dancing Princesses | The Worn-Out Slippers House, Fairy-Tale Forest | x
Dick Whittington | The Cat Stall, Gingerbread Lane
Jack the Giant Killer | The Giant's Castle, Fairy-Tale Forest
The Gingerbread Man | The Oven Door, Gingerbread Lane
Chicken Little | The Acorn Tree, Gingerbread Lane | c
The Little Red Hen | The Bakery, Gingerbread Lane | b
The Elves and the Shoemaker | The Shoemaker's Bench, Gingerbread Lane | b
Bluebell Fairy | The Bluebell Wood, Fairy-Tale Forest
Hans in Luck | The Road Home, Fairy-Tale Forest
The Musicians of Bremen | The Robbers' Cottage, Fairy-Tale Forest
@ Denmark / Andersen Row
The Little Mermaid | The Rock by the Harbour, Andersen Row
The Snow Queen | The Ice Palace, Andersen Row
Gerda | 3 Andersen Row
Kai | 5 Andersen Row
The Ugly Duckling | The Duck Pond, Andersen Row
Thumbelina | The Walnut Shell, Andersen Row | g
The Little Match Girl | The Street Corner, Andersen Row
The Steadfast Tin Soldier | The Toy Shelf, Andersen Row
The Emperor's New Clothes | The Palace Wardrobe, Andersen Row | x
The Nightingale | The Emperor's Garden, Andersen Row
Elisa of the Wild Swans | The Swan Tower, Andersen Row

# The Arabian Nights
@ Baghdad / Bazaar Street BZ
Scheherazade | The Palace Bedchamber, Bazaar Street | g
King Shahryar | The Palace, Baghdad
Aladdin | The Magic Lamp Shop, Bazaar Street | g
Ali Baba | The Cave Entrance, Bazaar Street | r
Morgiana | The Oil Jar Yard, Bazaar Street
Sinbad the Sailor | The Seven Voyages House, Bazaar Street | r
Princess Badroulbadour | The Palace Tower, Baghdad
Prince Ahmed | 5 Bazaar Street
Abu Hassan | 7 Bazaar Street
The Genie of the Lamp | The Lamp, Bazaar Street
Qasim | 9 Bazaar Street
Judar the Fisherman | The Fishing Quay, Bazaar Street | b
Pari Banu | The Fairy Palace, Baghdad
Dinarzade | 11 Bazaar Street

# Aesop's Fables
@ Aesop's Meadow / Fable Road
The Tortoise | The Finish Line, Fable Road | r
The Hare | The Napping Bank, Fable Road
The Ant | The Winter Store, Fable Road | b
The Grasshopper | The Fiddle Lawn, Fable Road
The Town Mouse | The Town House Skirting Board, Fable Road
The Country Mouse | The Field Burrow, Fable Road
The Crow | The Pitcher Stone, Fable Road
The Fox | The Vine Wall, Fable Road | c
The Shepherd Boy | The Sheep Hill, Fable Road | c
The Dog in the Manger | The Manger, Fable Road | c
The Milkmaid | The Pail Gate, Fable Road
The Miller and His Donkey | The Mill Road, Fable Road
The North Wind | The Cold Corner, Fable Road
The Frog Who Wished to Be King | The Pond Throne, Fable Road
The Lion and the Mouse | The Net Clearing, Fable Road
The Stork and the Fox | The Long-Necked Jug Shop, Fable Road
The Wolf in Sheep's Clothing | The Fleece Rack, Fable Road | x

# Mark Twain
@ St Petersburg / Cardiff Hill Road
Tom Sawyer | The Whitewashed Fence, Cardiff Hill Road | g
Huckleberry Finn | The Hogshead Barrel, Cardiff Hill Road
Becky Thatcher | The Judge's House, Cardiff Hill Road
Aunt Polly | The Sawyer Cottage, Cardiff Hill Road | c
Sid Sawyer | The Sawyer Cottage, Cardiff Hill Road
Widow Douglas | Douglas Villa, Cardiff Hill Road
Judge Thatcher | Thatcher House, Cardiff Hill Road
Muff Potter | 5 Cardiff Hill Road
@ Camelot and Hartford / Yankee Lane
Hank Morgan | The Colt Factory, Yankee Lane | b
Tom Canty | Offal Court, Yankee Lane
Miles Hendon | 4 Yankee Lane
Pudd'nhead Wilson | The Law Office, Yankee Lane | b
Jim Smiley | The Jumping Frog Pond, Calaveras County

# Louisa May Alcott
@ Concord / Orchard House Lane
Jo March | Orchard House, Concord | r
Meg March | Orchard House, Concord
Beth March | The Piano Room, Orchard House
Amy March | The Studio, Orchard House
Laurie Laurence | The Laurence Mansion, Concord
Marmee | Orchard House Kitchen, Concord
Aunt March | Plumfield Road, Concord | c
Mr Laurence | The Laurence Mansion, Concord
Professor Bhaer | Plumfield School, Concord
John Brooke | 3 Orchard House Lane

# L. Frank Baum, The Wonderful Wizard of Oz (1900)
@ Emerald City / Yellow Brick Road OZ
Dorothy Gale | The Farmhouse Landing, Yellow Brick Road | g
The Scarecrow | The Cornfield, Yellow Brick Road | r
The Tin Woodman | The Forest Cottage, Yellow Brick Road | r
The Cowardly Lion | The Forest Den, Yellow Brick Road | x
The Wizard of Oz | The Palace of Oz, Emerald City | b
Toto | The Kansas Kennel, Yellow Brick Road
Glinda | The Southern Palace, Emerald City
The Wicked Witch of the West | The Winkie Castle, Emerald City | c
Aunt Em | The Kansas Farm, Yellow Brick Road
Uncle Henry | The Kansas Farm, Yellow Brick Road
The Guardian of the Gates | The Emerald Gates, Emerald City | b
The Queen of the Field Mice | The Poppy Field, Yellow Brick Road

# Kenneth Grahame, The Wind in the Willows (1908)
@ The Riverbank / Willow Path RB
Mr Toad | Toad Hall, The Riverbank | x
Ratty | The Hole in the Bank, The Riverbank | r
Mole | Mole End, The Riverbank | r
Mr Badger | The Wild Wood Sett, The Riverbank
Otter | The Weir, The Riverbank
Portly | The Island, The Riverbank
The Gaoler's Daughter | The Dungeon Lodge, The Riverbank
The Chief Weasel | The Wild Wood, The Riverbank | x

# Oscar Wilde
@ Mayfair / Curzon Street
Dorian Gray | The Locked Attic, Curzon Street | r
Lord Henry Wotton | 4 Curzon Street
Basil Hallward | The Studio, Curzon Street
Algernon Moncrieff | Albany Chambers, Curzon Street | r
Jack Worthing | The Manor House, Woolton Hall
Lady Bracknell | 149 Upper Grosvenor Street | c
Gwendolen Fairfax | 6 Curzon Street
Cecily Cardew | The Manor House, Woolton Hall
Miss Prism | The Governess's Room, Woolton Hall
Dr Chasuble | The Rectory, Woolton Hall
Lord Goring | 8 Curzon Street
The Selfish Giant | The Walled Garden, Curzon Street | c
The Happy Prince | The Pedestal, Curzon Street
Sir Simon de Canterville | Canterville Chase, Curzon Street

# Leo Tolstoy, Dostoevsky and other Russian writers
@ Saint Petersburg / Nevsky Prospect
Anna Karenina | The Karenin House, Nevsky Prospect
Count Vronsky | The Cavalry Barracks, Nevsky Prospect
Konstantin Levin | The Pokrovskoe Estate, Nevsky Prospect
Kitty Shcherbatskaya | 3 Nevsky Prospect
Alexei Karenin | The Ministry, Nevsky Prospect | b
Pierre Bezukhov | The Moscow Mansion, Nevsky Prospect | r
Natasha Rostova | The Rostov House, Nevsky Prospect
Prince Andrei Bolkonsky | Bald Hills, Nevsky Prospect
Nikolai Rostov | 5 Nevsky Prospect
Princess Marya | Bald Hills, Nevsky Prospect
Platon Karataev | The Prison Barracks, Nevsky Prospect
Stiva Oblonsky | 7 Nevsky Prospect
Ivan Ilyich | The Judge's Chambers, Nevsky Prospect | c
Rodion Raskolnikov | The Rented Garret, Haymarket Square
Sonya Marmeladova | 9 Haymarket Square
Prince Myshkin | 11 Haymarket Square
Nastasya Filippovna | 13 Haymarket Square
Alyosha Karamazov | The Monastery Cell, Haymarket Square
Dmitri Karamazov | 15 Haymarket Square | x
Ivan Karamazov | 17 Haymarket Square | c
Porfiry Petrovich | The Magistrate's Office, Haymarket Square
Razumikhin | 19 Haymarket Square
Pavel Chichikov | The Dead Souls Office, Haymarket Square | b
Akaky Akakievich | The Overcoat Shop, Haymarket Square
Eugene Onegin | The Country Estate, Haymarket Square
Tatyana Larina | 21 Haymarket Square
Uncle Vanya | The Estate House, Haymarket Square
Madame Ranevskaya | The Cherry Orchard, Haymarket Square
Grigory Pechorin | The Caucasus Barracks, Haymarket Square
Yevgeny Bazarov | The Doctor's Cottage, Haymarket Square

# Swift, Defoe and the eighteenth century
@ Lilliput / Tiny Street
Lemuel Gulliver | The Beach, Tiny Street | r
Glumdalclitch | The Giant's Cottage, Brobdingnag
The Emperor of Lilliput | The Tiny Palace, Tiny Street
@ Robinson Crusoe's Island / Goat Path @HI
Robinson Crusoe | The Stockade, Goat Path | r
@ Moll's London / Newgate Lane
Moll Flanders | 4 Newgate Lane | x
Roxana | 6 Newgate Lane
Colonel Jack | 8 Newgate Lane
Captain Singleton | 10 Newgate Lane
@ Somerset / Squire's Road
Tom Jones | The Inn at Upton, Squire's Road
Squire Western | Western Hall, Squire's Road | c
Sophia Western | Western Hall, Squire's Road
Joseph Andrews | 3 Squire's Road
Tristram Shandy | Shandy Hall, Squire's Road
Uncle Toby | The Bowling Green, Shandy Hall
Corporal Trim | 5 Squire's Road
Dr Primrose | The Vicarage, Wakefield
Mrs Malaprop | 7 Squire's Road | c
Lydia Languish | 9 Squire's Road
Sir Peter Teazle | 11 Squire's Road | c
Lady Teazle | 11 Squire's Road
Sir Anthony Absolute | 13 Squire's Road
Pamela Andrews | 15 Squire's Road
Clarissa Harlowe | Harlowe Place, Squire's Road

# Chaucer, Beowulf and medieval tales
@ Tabard Inn / Pilgrim's Way
The Wife of Bath | The Tabard Inn, Pilgrim's Way | r
The Miller | The Mill Wagon, Pilgrim's Way
The Knight | 3 Pilgrim's Way
The Squire | 5 Pilgrim's Way
The Prioress | The Convent, Pilgrim's Way
The Monk | The Abbey Stables, Pilgrim's Way | x
The Friar | 7 Pilgrim's Way
The Merchant | 9 Pilgrim's Way | b
The Clerk of Oxford | 11 Pilgrim's Way
The Franklin | The Manor, Pilgrim's Way
The Pardoner | 13 Pilgrim's Way | c
The Summoner | 15 Pilgrim's Way
The Cook | The Pie Stall, Pilgrim's Way | b
The Reeve | 17 Pilgrim's Way
Chauntecleer | The Farmyard, Pilgrim's Way
Pertelote | The Farmyard, Pilgrim's Way
@ Heorot / Mead Hall Road
Beowulf | The Mead Hall, Heorot | r
Grendel | The Fen, Heorot | x
Hrothgar | The High Seat, Heorot
Wiglaf | 5 Mead Hall Road
Unferth | 7 Mead Hall Road | c
Wealhtheow | The Queen's Bower, Heorot

# Melville, Hawthorne, Irving and Poe
@ Nantucket / Harpoon Wharf
Captain Ahab | The Pequod, Harpoon Wharf | c
Ishmael | The Spouter Inn, Harpoon Wharf | r
Queequeg | The Harpoon Shop, Harpoon Wharf | b
Starbuck | The Chief Mate's Berth, Harpoon Wharf
Stubb | The Second Mate's Berth, Harpoon Wharf
Bartleby | The Scrivener's Desk, Wall Street Chambers
Billy Budd | The Foretop, Harpoon Wharf
Father Mapple | The Pulpit, Harpoon Wharf
@ Salem / Scarlet Street
Hester Prynne | The Cottage by the Shore, Scarlet Street
Arthur Dimmesdale | The Minister's House, Scarlet Street
Roger Chillingworth | The Herb Shop, Scarlet Street | b
Pearl Prynne | The Cottage by the Shore, Scarlet Street
Goodman Brown | 4 Scarlet Street
Hepzibah Pyncheon | The House of Seven Gables, Scarlet Street | b
Phoebe Pyncheon | The House of Seven Gables, Scarlet Street
@ Sleepy Hollow / Hudson Road
Rip Van Winkle | The Catskill Cottage, Hudson Road | r
Ichabod Crane | The Schoolhouse, Sleepy Hollow | r
Brom Bones | The Smithy, Sleepy Hollow | x
Katrina Van Tassel | Van Tassel Farm, Sleepy Hollow
The Headless Horseman | The Church Bridge, Sleepy Hollow
Diedrich Knickerbocker | 3 Hudson Road
@ Usher Tarn / Raven Road
C. Auguste Dupin | The Shuttered Room, Rue Morgue Lane
Roderick Usher | The House of Usher, Raven Road
Madeline Usher | The House of Usher, Raven Road
Fortunato | The Wine Cellar, Raven Road
Montresor | The Palazzo, Raven Road
Prince Prospero | The Abbey, Raven Road
Lenore | The Chamber Door, Raven Road
William Wilson | 3 Raven Road
Ligeia | The Bridal Chamber, Raven Road

# Gilbert and Sullivan
@ Titipu / Mikado Row TP
Ko-Ko | The Lord High Executioner's Office, Mikado Row | b
Yum-Yum | The Ladies' School, Mikado Row
Nanki-Poo | The Wandering Minstrel's Cart, Mikado Row
Pooh-Bah | The Lord High Everything Else, Mikado Row | b
Katisha | The Palace Gate, Mikado Row | c
Pish-Tush | 3 Mikado Row
@ Cornwall / Pirate Cove
Frederic | The Pirate Ship, Pirate Cove
Mabel Stanley | The Ruined Chapel, Pirate Cove
Major-General Stanley | The Modern Major-General's Mansion, Pirate Cove | c
The Pirate King | The Pirate Ship, Pirate Cove | x
Ruth | The Maid-of-All-Work Cottage, Pirate Cove
The Sergeant of Police | The Police Station, Pirate Cove
@ Portsmouth / Quarterdeck Quay
Captain Corcoran | The Pinafore, Quarterdeck Quay
Ralph Rackstraw | The Foc'sle, Quarterdeck Quay
Sir Joseph Porter | The Admiralty Desk, Quarterdeck Quay | b
Josephine Corcoran | The Captain's Cabin, Quarterdeck Quay
Little Buttercup | The Bumboat, Quarterdeck Quay | b
Dick Deadeye | The Bilge, Quarterdeck Quay | c
@ Fairyland / Peerage Place
Iolanthe | The Stream Bed, Peerage Place
Strephon | The Arcadian Meadow, Peerage Place
The Lord Chancellor | The Woolsack, Peerage Place
Phyllis | 3 Peerage Place
Reginald Bunthorne | The Aesthetic Poet's Rooms, Peerage Place
Archibald Grosvenor | 5 Peerage Place
Robin Oakapple | The Ruddigore Cottage, Peerage Place
Sir Ruthven Murgatroyd | Ruddigore Castle, Peerage Place
Mad Margaret | 7 Peerage Place
Jack Point | The Jester's Caravan, Tower Green
Duke of Plaza-Toro | The Plaza-Toro Palace, Peerage Place
Marco Palmieri | The Gondola Yard, Peerage Place
Giuseppe Palmieri | The Gondola Yard, Peerage Place

# Nursery rhymes and English folk tales
@ Mother Goose Lane / Rhyme Row MG
Jack Sprat | The Fat-Free Kitchen, Rhyme Row | c
Little Bo Peep | The Lost Sheep Meadow, Rhyme Row
Little Boy Blue | The Haystack, Rhyme Row
Little Miss Muffet | The Tuffet, Rhyme Row
Little Jack Horner | The Corner, Rhyme Row | g
Old King Cole | The Merry Old Palace, Rhyme Row | r
Mistress Mary | The Cockle Shell Garden, Rhyme Row | c
Georgie Porgie | 3 Rhyme Row | x
Simple Simon | The Pie Stall, Rhyme Row
Wee Willie Winkie | The Nightgown Lane, Rhyme Row
Old Mother Hubbard | The Bare Cupboard, Rhyme Row | c
Polly Flinders | The Cinders Corner, Rhyme Row
Doctor Foster | The Puddle Surgery, Rhyme Row | x
Peter Piper | The Pickled Pepper Shop, Rhyme Row | b
Mother Goose | The Goose Barn, Mother Goose Lane
Tommy Tucker | The Supper Table, Rhyme Row
Jack Be Nimble | The Candlestick Yard, Rhyme Row
Solomon Grundy | 5 Rhyme Row
Lucy Locket | 7 Rhyme Row
Bobby Shafto | The Silver Buckle Quay, Rhyme Row
Jack Frost | The Window Pane, Rhyme Row
Old Mother Shipton | The Cave, Rhyme Row
Tom Tinker | The Tinker's Yard, Rhyme Row | b
The Muffin Man | Drury Lane Bakery, Rhyme Row | b
The Old Woman Who Lived in a Shoe | The Shoe, Rhyme Row | c
Jack and Jill | The Hill Well, Rhyme Row
Mary Quite Contrary | The Silver Bell Garden, Rhyme Row
The Owl and the Pussycat | The Pea-Green Boat, Rhyme Row
The Dong with a Luminous Nose | The Gromboolian Plain, Rhyme Row
The Quangle Wangle | The Crumpetty Tree, Rhyme Row
The Jumblies | The Sieve, Rhyme Row

# Myths and legends from elsewhere
@ Sumer / Ziggurat Street
Gilgamesh | The Walls of Uruk, Ziggurat Street | r
Enkidu | The Wild Steppe, Ziggurat Street
Ishtar | The Temple, Ziggurat Street | c
Utnapishtim | The Ark, Ziggurat Street
@ Thebes / Nile Bank Road
Isis | The Temple Island, Nile Bank Road
Osiris | The Tomb Hall, Nile Bank Road
Horus | The Falcon Perch, Nile Bank Road
Anubis | The Embalming Hall, Nile Bank Road | b
Thoth | The Library, Nile Bank Road | b
Bastet | The Cat Temple, Nile Bank Road
Sekhmet | 3 Nile Bank Road | c
Ra | The Sun Boat, Nile Bank Road
@ Ulster and Tara / Hero's Road
Cuchulainn | The Hound's Forge, Hero's Road
Finn McCool | The Giant's Causeway, Hero's Road | r
Oisin | The Land of Youth, Hero's Road
Deirdre | 3 Hero's Road
Queen Medb | The Cattle Raid Camp, Hero's Road | c
@ Wales / Mabinogion Hill
Pwyll | The Court at Arberth, Mabinogion Hill
Rhiannon | The Pale Horse Meadow, Mabinogion Hill
Bran the Blessed | The Giant's Hall, Mabinogion Hill
Branwen | 3 Mabinogion Hill
Blodeuwedd | The Owl Wood, Mabinogion Hill
@ Old Russia / Birch Lane
Baba Yaga | The Hut on Chicken Legs, Birch Lane | c
Vasilisa the Beautiful | The Skull Lantern Cottage, Birch Lane
Koschei the Deathless | The Castle, Birch Lane
The Firebird | The Golden Apple Tree, Birch Lane
Ivan Tsarevich | The Grey Wolf Stable, Birch Lane
@ Old Japan and China / Peach Blossom Road
Momotaro | The Peach Cottage, Peach Blossom Road
Urashima Taro | The Sea Palace, Peach Blossom Road
Princess Kaguya | The Bamboo Grove, Peach Blossom Road
The Monkey King | The Flower Fruit Mountain, Peach Blossom Road | x
Zhu Bajie | The Pig Pen, Peach Blossom Road
Anansi the Spider | The Web, Peach Blossom Road | x
Reynard the Fox | The Earth, Malepartus Lane
Till Eulenspiegel | The Cart, Malepartus Lane | x

# Later nineteenth and early twentieth century novels
@ Wessex / Casterbridge Road
Tess Durbeyfield | The Dairy, Casterbridge Road
Jude Fawley | The Stonemason's Yard, Casterbridge Road | b
Bathsheba Everdene | Weatherbury Farm, Casterbridge Road | r
Gabriel Oak | The Shepherd's Hut, Casterbridge Road
Michael Henchard | The Corn Merchant's, Casterbridge Road | b
Sergeant Troy | 3 Casterbridge Road
Eustacia Vye | Rainbarrow Heath, Casterbridge Road
Angel Clare | Talbothays Dairy, Casterbridge Road
Farmer Boldwood | 5 Casterbridge Road
@ Middlemarch / Loamshire Lane
Dorothea Brooke | Tipton Grange, Loamshire Lane
Mr Casaubon | Lowick Manor, Loamshire Lane
Silas Marner | The Weaver's Cottage, Raveloe
Maggie Tulliver | Dorlcote Mill, Loamshire Lane
Will Ladislaw | 3 Loamshire Lane
Tertius Lydgate | The Doctor's House, Loamshire Lane
Rosamond Vincy | 5 Loamshire Lane | x
Adam Bede | The Carpenter's Shop, Hayslope
@ Vanity Fair / Pump Court
Becky Sharp | Miss Pinkerton's Academy, Pump Court | x
Amelia Sedley | 2 Russell Square, Pump Court
Rawdon Crawley | 4 Pump Court
Captain Dobbin | 6 Pump Court
Lord Steyne | Gaunt House, Pump Court
Barry Lyndon | 8 Pump Court
@ Barchester / Cathedral Close
Archdeacon Grantly | The Deanery, Cathedral Close
Mr Harding | Hiram's Hospital, Cathedral Close
Obadiah Slope | 3 Cathedral Close
Mrs Proudie | The Bishop's Palace, Cathedral Close | c
Plantagenet Palliser | 5 Cathedral Close
Lady Glencora | 7 Cathedral Close
@ Victorian Mysteries / Gaslight Street
Count Fosco | The Villa, Gaslight Street
Marian Halcombe | Limmeridge House, Gaslight Street
Walter Hartright | 3 Gaslight Street
Sergeant Cuff | 5 Gaslight Street
Franklin Blake | 7 Gaslight Street
@ Cranford / Market Street
Miss Matty | The Tea Room, Market Street
Miss Deborah Jenkyns | 3 Market Street
@ Adventure Stories / Quatermain Road
Allan Quatermain | The Hunter's Lodge, Quatermain Road
Ayesha | The Caves of Kor, Quatermain Road
Sir Percy Blakeney | Richmond Manor, Quatermain Road | r
Marguerite Blakeney | Richmond Manor, Quatermain Road
@ Three Men on the Thames / Boat Lane
J. from Three Men in a Boat | The Boat House, Boat Lane
Harris | 3 Boat Lane
George | 5 Boat Lane
Montmorency | The Kennel, Boat Lane | c
@ Mansfield and Avonlea / Green Gables Road
Anne Shirley | Green Gables, Avonlea
Gilbert Blythe | 3 Green Gables Road
Marilla Cuthbert | Green Gables, Avonlea
Matthew Cuthbert | Green Gables, Avonlea
Mary Lennox | Misselthwaite Manor, Yorkshire Moor | g
Colin Craven | The East Wing, Misselthwaite Manor
Dickon Sowerby | The Moor Cottage, Yorkshire Moor
Little Lord Fauntleroy | Dorincourt Castle, Green Gables Road
Sara Crewe | The Attic, Miss Minchin's Seminary
Heidi | The Alpine Hut, Green Gables Road
Peter the Goatherd | The Goat Pasture, Green Gables Road
Pinocchio | The Puppet Theatre, Via Collodi | x
Geppetto | The Woodcarver's Workshop, Via Collodi | b
The Talking Cricket | The Skirting Board, Via Collodi
Tom the Water Baby | The River Bed, Green Gables Road
Black Beauty | The Stable, Birtwick Park
Lord Jim | The Patusan Stockade, Green Gables Road
Charles Marlow | The Thames Yawl, Green Gables Road
Nostromo | The Lighter, Sulaco Wharf
Mr Verloc | The Shop in Brett Street, Green Gables Road | b
Daisy Miller | The Grand Hotel, Vevey
Isabel Archer | Gardencourt, Green Gables Road
Jay Gatsby | The West Egg Mansion, Long Island Sound | r
Daisy Buchanan | The East Egg House, Long Island Sound
Nick Carraway | The Cottage, West Egg
Tom Buchanan | The East Egg House, Long Island Sound | c
Jordan Baker | 3 East Egg Row

# French, German and other Continental classics
@ Yonville / Rue de l'Abbaye
Emma Bovary | The Doctor's House, Rue de l'Abbaye | x
Charles Bovary | The Surgery, Rue de l'Abbaye
Julien Sorel | The Tutor's Room, Rue de l'Abbaye
Pere Goriot | The Pension Vauquer, Rue de l'Abbaye
Eugene de Rastignac | The Pension Vauquer, Rue de l'Abbaye
Cousin Bette | 3 Rue de l'Abbaye
Nana | 5 Rue de l'Abbaye
Gervaise Macquart | The Laundry, Rue de l'Abbaye | b
Candide | The Castle of Thunder-ten-tronckh, Rue de l'Abbaye | r
Cunegonde | 7 Rue de l'Abbaye
Dr Pangloss | 9 Rue de l'Abbaye
Tartuffe | The Orgon House, Rue de l'Abbaye | c
Harpagon | The Miser's Counting Room, Rue de l'Abbaye | c
Monsieur Jourdain | The Draper's Mansion, Rue de l'Abbaye
Don Juan | The Cloak Shop, Rue de l'Abbaye
Roxane | The Convent Garden, Rue de l'Abbaye
Christian de Neuvillette | 11 Rue de l'Abbaye
@ Wittenberg / Faust Gasse
Faust | The Study, Faust Gasse | r
Mephistopheles | The Black Poodle Kennel, Faust Gasse
Gretchen | The Spinning Room, Faust Gasse
Clara Stahlbaum | The Christmas Tree Room, Faust Gasse | g
The Nutcracker | The Toy Cupboard, Faust Gasse
The Mouse King | The Wainscot, Faust Gasse
Nora Helmer | A Doll's House, Faust Gasse
Torvald Helmer | A Doll's House, Faust Gasse | b
Hedda Gabler | The Tesman Villa, Faust Gasse
Peer Gynt | The Troll Hall, Faust Gasse
@ Venice Carnival / Commedia Alley
Harlequin | The Patchwork Wardrobe, Commedia Alley
Pantalone | The Merchant's Counting House, Commedia Alley | b
Columbina | 3 Commedia Alley
Pulcinella | 5 Commedia Alley
Pierrot | The Moonlit Window, Commedia Alley
@ The Jungle / Seeonee Hills
Mowgli | The Wolf Den, Seeonee Hills | g
Bagheera | The Ancient Cold Lairs, Seeonee Hills
Shere Khan | The Waingunga Riverbank, Seeonee Hills | c
Akela | The Council Rock, Seeonee Hills
Rikki-Tikki-Tavi | The Bungalow Garden, Seeonee Hills
Kim | The Lahore Museum Steps, Seeonee Hills
`;

// ---------------------------------------------------------------------------------------------------------------------
// Places and invented postcode areas

/** Every real UK postcode area (and other real or reserved prefixes). Invented areas must never be one of these. */
export const REAL_UK_AREAS = new Set(("AB AL B BA BB BD BH BL BN BR BS BT CA CB CF CH CM CO CR CT CV CW DA DD DE DG DH DL DN DT DY E EC EH EN EX FK FY G GL GU GY HA HD HG HP HR HS HU HX IG IM IP IV JE KA KT KW KY L LA LD LE LL LN LS LU M ME MK ML N NE NG NN NP NR NW OL OX PA PE PH PL PO PR RG RH RM S SA SE SG SK SL SM SN SO SP SR SS ST SW SY TA TD TF TN TQ TR TS TW UB W WA WC WD WF WN WR WS WV YO ZE BF BX GI XX").split(" "));
/** Areas the shop cannot deliver to (business/data/business.json delivery.excluded_postcode_prefixes). The real ones are never used. */
export const EXCLUDED_FAKE_AREA = "HI";

const KINDS = { g: "gift", r: "regular", x: "returns_a_lot", c: "complains", b: "business" };
/** Share of characters with no kind letter: mostly gift buyers and regulars, like the real mix. */
const DEFAULT_KINDS = [["gift", 0.58], ["regular", 0.38], ["returns_a_lot", 0.04]];
const pickDefaultKind = (name) => {
  let r = (hashString("kind|" + name) % 10000) / 10000;
  for (const [kind, share] of DEFAULT_KINDS) { if (r < share) return kind; r -= share; }
  return "gift";
};

const LETTERS = "ABDEFGHJLNPQRSTUWXYZ";
const usedAreas = new Map(); // area -> place
/** Gives every place its own invented two-letter area. An explicit one ("SF") wins; HI marks the excluded Highlands and Islands. */
function areaFor(place, explicit) {
  if (explicit) {
    if (REAL_UK_AREAS.has(explicit)) throw new Error(`Postcode area ${explicit} for ${place} is a real UK area`);
    if (explicit !== EXCLUDED_FAKE_AREA && usedAreas.has(explicit) && usedAreas.get(explicit) !== place) throw new Error(`Postcode area ${explicit} already used by ${usedAreas.get(explicit)}`);
    usedAreas.set(explicit, place);
    return explicit;
  }
  const letters = place.toUpperCase().replace(/[^A-Z]/g, "");
  const words = place.toUpperCase().replace(/[^A-Z ]/g, "").split(" ").filter(Boolean);
  const candidates = [];
  if (words.length > 1) candidates.push(words[0][0] + words[1][0]);
  for (let i = 1; i < letters.length; i++) candidates.push(letters[0] + letters[i]);
  for (let i = 0; i < letters.length; i++) for (let j = i + 1; j < letters.length; j++) candidates.push(letters[i] + letters[j]);
  for (const a of candidates) {
    if (a.length === 2 && !REAL_UK_AREAS.has(a) && a !== EXCLUDED_FAKE_AREA && !usedAreas.has(a) && !["MH", "QQ", "ZZ"].includes(a)) { usedAreas.set(a, place); return a; }
  }
  throw new Error("No free postcode area for " + place);
}

/** Made-up postcode for one character: the place's area, a district for the place, and a sector from the name. */
export function postcodeFor(name, place, area) {
  const district = 1 + (hashString("district|" + place) % 9);
  const h = hashString("postcode|" + name);
  return `${area}${district} ${1 + (h % 9)}${LETTERS[(h >>> 4) % LETTERS.length]}${LETTERS[(h >>> 9) % LETTERS.length]}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Parse the list

const STREETISH = /(Street|Road|Lane|Row|Court|Square|Walk|Quay|Path|Hill|Terrace|Gasse|Prospect|Steps|Place|Wharf|Close|Way|Fields)$/;
/** Splits "Toad Hall, The Riverbank" into the address line and the town. A street-like tail stays in the line. */
function splitAddress(address, place) {
  if (/, (Via|Rue) /.test(address)) return { line: address, town: place };
  const i = address.lastIndexOf(", ");
  if (i < 0) return { line: address, town: place };
  const tail = address.slice(i + 2);
  if (STREETISH.test(tail)) return { line: address, town: place };
  return { line: address.slice(0, i), town: tail };
}

const parse = () => {
  const out = [], seen = new Set(), places = new Map();
  let from = "", place = "", street = "", area = "", counter = 0;
  for (const raw of CHARACTER_TEXT.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("# ")) { from = line.slice(2); continue; }
    if (line.startsWith("@ ")) {
      let spec = line.slice(2), explicit = null;
      const m = spec.match(/\s+@\s*([A-Z]{2})\s*$/) || spec.match(/\s+([A-Z]{2})$/);
      if (m) { explicit = m[1]; spec = spec.slice(0, m.index); }
      [place, street] = spec.split(" / ").map((s) => s.trim());
      if (!places.has(place)) places.set(place, areaFor(place, explicit));
      area = places.get(place);
      counter = 0;
      continue;
    }
    let [name, address, kindLetter] = line.split("|").map((s) => s.trim());
    if (!kindLetter && address && /^[gcrxb]$/.test(address)) { kindLetter = address; address = ""; }
    if (!address) address = `${3 + (counter++ % 40) * 2} ${street}`;
    const { line: address_line, town } = splitAddress(address, place);
    const kind = KINDS[kindLetter] || pickDefaultKind(name);
    if (seen.has(name)) throw new Error("Duplicate character: " + name);
    seen.add(name);
    out.push({ name, from, home: `${address_line}, ${town}`, address_line, town, kind, postcode: postcodeFor(name, town, area), area });
  }
  return { characters: out, places };
};

const parsed = parse();
export const CHARACTERS = parsed.characters;
/** place name -> postcode area */
export const PLACE_AREAS = Object.fromEntries(parsed.places);
/** Every invented area in use, for the validator. */
export const CHARACTER_AREAS = [...new Set([...parsed.places.values(), EXCLUDED_FAKE_AREA])];

/**
 * The 36 characters who carry the hand-written stories, in customer id order (C-1001 to C-1036).
 * Choices that matter: C-1027 and C-1028 are two Capulets in Verona (story 22); C-1033 and C-1034 live in the
 * Highlands (story 26); C-1022 is a clerk who orders sandwiches for an office (story 34).
 */
export const PLANTED = [
  "Elizabeth Bennet", "Jane Eyre", "Tom Sawyer", "Dorothy Gale", "Phileas Fogg", "Emma Woodhouse", "Captain Nemo", "Little Red Riding Hood", "Sinbad the Sailor",
  "Gretel", "Mr Toad", "Goldilocks", "Pip", "Robin Hood", "Miss Havisham", "Long John Silver", "Becky Sharp", "Count of Monte Cristo", "Mary Lennox", "Jo March",
  "Ali Baba", "Bob Cratchit", "Mrs Bennet", "Ichabod Crane", "Cinderella", "Ebenezer Scrooge", "Juliet Capulet", "Tybalt Capulet", "Queen of Hearts", "Dr Watson",
  "Snow White", "Pinocchio", "Lady Macbeth", "Macbeth", "Thumbelina", "Mowgli",
];
export const byName = Object.fromEntries(CHARACTERS.map((c) => [c.name, c]));
for (const n of PLANTED) if (!byName[n]) throw new Error("Planted character missing from the list: " + n);
// The two planted HI customers live in the excluded Highlands.
// (Lady Macbeth and Macbeth: Dunsinane, area HI.)

// ---------------------------------------------------------------------------------------------------------------------
// Second pass

const RELATIONS = [
  ["{N}'s neighbour", "Next door to {L}"],
  ["A cousin of {N}", "Near {L}"],
  ["{N}'s old friend", "Close to {L}"],
  ["{N}'s lodger", "Lodging at {L}"],
  ["{N}'s godparent", "Across the lane from {L}"],
  ["A colleague of {N}", "Round the corner from {L}"],
  ["{N}'s landlord", "Over the road from {L}"],
  ["{N}'s dentist", "Behind {L}"],
  ["{N}'s housekeeper", "Below stairs at {L}"],
  ["{N}'s gardener", "The cottage by {L}"],
  ["{N}'s tailor", "The shop opposite {L}"],
  ["A niece of {N}", "Staying at {L}"],
  ["A nephew of {N}", "Staying at {L}"],
  ["{N}'s cook", "The kitchen door, {L}"],
  ["{N}'s coachman", "The mews behind {L}"],
  ["The secretary of {N}'s club", "The club rooms near {L}"],
  ["{N}'s apprentice", "The workshop by {L}"],
  ["{N}'s aunt", "The house beside {L}"],
];
/** How many relation patterns there are: applyPass(c, 1) to applyPass(c, RELATION_COUNT) each give a different one. */
export const RELATION_COUNT = RELATIONS.length;
const ROMAN = ["", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const possessive = (n) => (n.endsWith("s") ? n + "'" : n + "'s");

/** The character for the Nth use of a list entry. pass 0 is the plain list; pass 1 and up add a relation. */
export function applyPass(c, pass) {
  if (pass === 0) return c;
  const [pattern, near] = RELATIONS[(pass - 1) % RELATIONS.length];
  const cycle = Math.floor((pass - 1) / RELATIONS.length);
  let name = pattern.replace("{N}'s", possessive(c.name)).replace("{N}", c.name);
  if (cycle > 0) name += " " + (ROMAN[cycle] || cycle + 1);
  const address_line = near.replace("{L}", c.address_line);
  const area = c.postcode.match(/^[A-Z]+/)[0];
  return { ...c, name, address_line, home: `${address_line}, ${c.town}`, postcode: postcodeFor(name, c.town, area), base: c.name };
}

/** Lowercase dotted slug used for email addresses: "Count Dracula's neighbour" -> count.draculas.neighbour */
export const slug = (name) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");

/** The kind in the character list maps to a customer type in customers.mjs. */
export const KIND_TO_TYPE = { gift: "gift", regular: "regular", returns_a_lot: "returner", complains: "complainer", business: "business" };

export function excludedHome(c) { return c.postcode.startsWith(EXCLUDED_FAKE_AREA); }
