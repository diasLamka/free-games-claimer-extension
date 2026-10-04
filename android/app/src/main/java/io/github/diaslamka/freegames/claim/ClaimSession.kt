package io.github.diaslamka.freegames.claim

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Bargain
import io.github.diaslamka.freegames.data.Family
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.OwnedCheck
import io.github.diaslamka.freegames.data.Relay
import io.github.diaslamka.freegames.data.RelayLink
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.AccountState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.OracleNote
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.notify.Notifier
import io.github.diaslamka.freegames.sources.Countries
import io.github.diaslamka.freegames.sources.JSON
import io.github.diaslamka.freegames.sources.Localize
import io.github.diaslamka.freegames.sources.SteamSource
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.bool
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.obj
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import io.github.diaslamka.freegames.sources.text
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.coroutines.resume
import io.github.diaslamka.freegames.data.runCatchingSuspend

/**
 * La recuperation, dans une vraie page de magasin.
 *
 * LE MOTEUR EST CELUI DE L'EXTENSION. content/free-games-claimer.js est
 * recopie dans l'appli a chaque build, et injecte dans la page -- dans toutes
 * ses frames, iframe de paiement d'Epic comprise -- comme le fait le script
 * de contenu de l'extension. Il parle a l'appli par le canal `fgcNative` (voir
 * assets/engine/android-shim.js) avec le protocole de watch/claim.js : suis-je
 * pilote, pret, ordre de reclamer, verdict.
 *
 * Steam n'a pas de moteur injecte, comme dans l'extension : son etape est
 * `steamPageStep`, de watch/steam-claim.js, jouee dans la page, et la preuve
 * est la bibliotheque (dynamicstore/userdata) -- jamais la page seule.
 */
class ClaimSession(
    private val context: Context,
    private val scope: CoroutineScope,
    /**
     * Sans ecran (2.0 : « ecran eteint ») : la page n'est attachee a aucune
     * fenetre. Elle est mesuree a la taille de l'ecran du telephone, comme un
     * onglet d'arriere-plan de l'extension -- que le moteur sait deja servir.
     * Un defi (captcha) n'y est JAMAIS resolu : il part en notification.
     */
    private val headless: Boolean = false,
    /**
     * Toute la famille (1.9.0) : l'identifiant du membre pour qui l'on
     * recupere, ou null pour le compte principal. Sa page vit dans son profil
     * WebView ; ses verdicts vont a ses jeux ; le relais avec le PC -- qui est
     * celui du compte principal -- n'en sait rien.
     */
    val member: String? = null,
) {
    /** Le nom du membre, pour le panneau et les notifications. */
    val memberName: String? get() = Family.member(Graph.store.value, member)?.name

    data class Outcome(val key: String, val title: String, val store: String, val verdict: String, val details: String?)

    data class Ui(
        val running: Boolean = false,
        val title: String? = null,
        val store: String? = null,
        val index: Int = 0,
        val total: Int = 0,
        val step: String? = null,
        val needsUser: Boolean = false,
        /** `needsUser` pour « montre-moi le bouton » plutot que pour un defi (1.21.0). */
        val teach: Boolean = false,
        val outcomes: List<Outcome> = emptyList(),
        val visible: Boolean = false,
    )

    private val _ui = MutableStateFlow(Ui())
    val ui: StateFlow<Ui> = _ui

    private var job: Job? = null
    private var piloting = false
    // Ce que la boucle attend de la page ; internal pour que rendererGone se teste.
    internal var ready: CompletableDeferred<String>? = null
    internal var verdict: CompletableDeferred<JsonElement>? = null
    internal var pageLoad: CompletableDeferred<String>? = null
    internal var userDone: CompletableDeferred<Boolean>? = null
    private var mainProxy: JavaScriptReplyProxy? = null
    @Volatile private var currentUrl: String? = null

    val engineInjected: Boolean
        get() = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)

    private var web: WebView? = null

    /** Monte d'un a chaque fois que la page est refaite (son moteur de rendu s'est arrete) : l'ecran rattache la neuve. */
    private val _pages = MutableStateFlow(0)
    val pages: StateFlow<Int> = _pages

    /**
     * Une recuperation DEMANDEE a l'ecran (1.17.1) et non decidee par la veille :
     * le moteur ne se fie alors pas a sa memoire (voir `epicForceRecheck` dans
     * src/core/16-epic-run.js) -- elle a deja ecrit « deja recupere » sur un jeu
     * qui ne l'etait pas, et un geste explicite est plus recent qu'elle.
     */
    private var forced = false
    /** Les offres sur lesquelles TU as touche « Recuperer » : seules elles peuvent redemander « montre-moi le bouton ». */
    private var targeted: Set<String> = emptySet()
    /** Ta reponse sur le panneau (« deja a moi », « plus offert »), en attendant que la boucle la lise. */
    private var teachAnswer: String? = null
    val webView: WebView get() = web ?: build().also { web = it }

    private fun log(msg: String) = Log.i("FGC", msg)

    /* --------------------------------------------------------- la page */

    private fun engineScript(): String {
        val shim = context.assets.open("engine/android-shim.js").bufferedReader().readText()
        val engine = context.assets.open("engine/free-games-claimer.js").bufferedReader().readText()
        return "(function(){\n" +
            "if (window.__fgcAndroid) return; window.__fgcAndroid = true;\n" +
            "function fgcGo(){\n" + shim + "\n" + engine + "\n}\n" +
            "if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fgcGo, { once: true }); else fgcGo();\n" +
            "})();"
    }

    /** L'etape Steam de l'extension, sans ses `import`/`export` : une fonction a appeler. */
    private val steamModule: String by lazy {
        context.assets.open("engine/steam-claim.js").bufferedReader().readText()
            .replace(Regex("(?m)^import[^\\n]*\\n"), "")
            .replace(Regex("(?m)^export\\s+"), "")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun build(): WebView = WebView(context).apply {
        // Avant tout autre usage de la page : ses cookies seront ceux du membre.
        if (member != null) Family.attach(this, member)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.userAgentString = Graph.userAgent()
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.setSupportZoom(true)
        settings.builtInZoomControls = true
        settings.displayZoomControls = false
        settings.mediaPlaybackRequiresUserGesture = true
        // Une page de magasin n'a rien a lire sur le telephone.
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
            androidx.webkit.WebSettingsCompat.setSafeBrowsingEnabled(settings, true)
        }
        val jar = if (member != null && Family.supported()) WebViewCompat.getProfile(this).cookieManager else CookieManager.getInstance()
        jar.setAcceptCookie(true)
        jar.setAcceptThirdPartyCookies(this, true)

        webViewClient = object : RenderSafeClient({ didCrash -> rendererGone(this@apply, didCrash) }) {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Les liens vers les lanceurs (com.epicgames.launcher://, steam://) ne s'ouvrent pas ici.
                val scheme = request.url.scheme?.lowercase()
                return scheme != "http" && scheme != "https"
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                currentUrl = url
            }

            override fun onPageFinished(view: WebView, url: String) {
                currentUrl = url
                if (!engineInjected && piloting && Titles.storeFromUrl(url) in Stores.ENGINE) {
                    view.evaluateJavascript(engineScript(), null)
                }
                pageLoad?.complete(url)
            }
        }
        webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                if (m.message().contains("[FGC]")) log(m.message().take(300))
                return true
            }
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(this, "fgcNative", ORIGINS) { _, message, _, isMainFrame, proxy ->
                onMessage(message, isMainFrame, proxy)
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(this, engineScript(), ORIGINS)
        }
        if (headless) {
            val m = context.resources.displayMetrics
            val w = android.view.View.MeasureSpec.makeMeasureSpec(m.widthPixels, android.view.View.MeasureSpec.EXACTLY)
            val h = android.view.View.MeasureSpec.makeMeasureSpec(m.heightPixels, android.view.View.MeasureSpec.EXACTLY)
            measure(w, h)
            layout(0, 0, m.widthPixels, m.heightPixels)
        }
    }

    /**
     * Le moteur de rendu de la page s'est arrete (memoire, plantage) : cette WebView est inutilisable, et si Android
     * n'est pas prevenu qu'on l'a geree (RenderSafeClient), il arrete aussi l'appli. On la jette -- la prochaine page
     * en aura une neuve --, et tout ce que la boucle attendait d'elle est libere avec la raison, au lieu d'attendre
     * son delai : l'offre en cours finit en echec, les suivantes repartent d'une page saine.
     */
    internal fun rendererGone(dead: WebView, didCrash: Boolean) {
        log("moteur de rendu ${if (didCrash) "plante" else "arrete"} : la page est refaite")
        if (web === dead) web = null
        piloting = false
        mainProxy = null
        (dead.parent as? ViewGroup)?.removeView(dead)
        runCatching { dead.destroy() }
        val why = RendererGone(didCrash)
        ready?.completeExceptionally(why)
        verdict?.completeExceptionally(why)
        pageLoad?.completeExceptionally(why)
        userDone?.complete(false)
        _ui.value = _ui.value.copy(needsUser = false, teach = false)
        _pages.value += 1
    }

    /* ------------------------------------------------------ le canal */

    private fun onMessage(message: WebMessageCompat, isMainFrame: Boolean, proxy: JavaScriptReplyProxy) {
        val data = parseJson(message.data) ?: return
        val id = data["id"].text?.toLongOrNull()
        val msg = data["msg"]
        fun reply(payload: JsonElement) {
            if (id == null) return
            val text = buildJsonObject { put("replyTo", id); put("payload", payload) }.toString()
            scope.launch(Dispatchers.Main) { runCatching { proxy.postMessage(text) } }
        }
        when (msg["type"].str) {
            "fgc-suis-je-pilote" -> reply(buildJsonObject { put("piloted", isMainFrame && piloting) })
            "fgc-storage-get" -> reply(storageGet(msg["keys"]))
            "fgc-storage-set" -> msg["items"].obj?.let { items ->
                scope.launch { Graph.store.update { if (member != null) Family.engineWrite(it, member, items) else it.copy(engine = it.engine + items) } }
            }
            "fgc-storage-remove" -> {
                val keys = msg["keys"].arr?.mapNotNull { it.str }.orEmpty().toSet()
                scope.launch { Graph.store.update { if (member != null) Family.engineRemove(it, member, keys) else it.copy(engine = it.engine - keys) } }
            }
            "fgc-pret" -> if (isMainFrame && piloting) {
                mainProxy = proxy
                ready?.complete(msg["url"].str.orEmpty())
            }
            "fgc-verdict" -> if (isMainFrame && piloting) verdict?.complete(msg ?: JsonNull)
            // Le moteur a appris le bouton d'un clic de l'utilisateur : on reessaie ce jeu.
            "fgc-appris" -> if (isMainFrame && piloting) userDone?.complete(true)
            "fgc-fetch" -> scope.launch { reply(fetchFor(msg["url"].str)) }
            else -> log("moteur : ${msg["type"].str} ${msg["title"].str.orEmpty()} ${msg["text"].str.orEmpty()}".take(200))
        }
    }

    /** Ce que le moteur lit de son stockage, avec le pays choisi dans l'appli. */
    private fun storageGet(keys: JsonElement?): JsonObject {
        val s = Graph.store.value
        val country = Countries.of(s.settings.country)
        val base = Family.member(s, member)?.let { Family.engineFor(s, it) } ?: s.engine
        val all = base + mapOf(
            "FGC_epic_country" to JsonPrimitive(country.code),
            "FGC_epic_lang" to JsonPrimitive(country.lang),
        )
        val wanted: Set<String>? = when (keys) {
            null, is JsonNull -> null
            is JsonPrimitive -> setOf(keys.content)
            else -> keys.arr?.mapNotNull { it.str }?.toSet()
        }
        return JsonObject(if (wanted == null) all else all.filterKeys { it in wanted })
    }

    /** Le moteur ne lit que des API publiques de magasins : rien d'autre ne passe. */
    private suspend fun fetchFor(url: String?): JsonElement {
        val host = Titles.hostOf(url)
        val allowed = host != null && url!!.startsWith("https://") &&
            ALLOWED_FETCH.any { host == it || host.endsWith(".$it") }
        if (!allowed) return buildJsonObject { put("error", "hote refuse") }
        return try {
            val r = Graph.http.get(url!!)
            buildJsonObject { put("status", r.code); put("body", r.body) }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            buildJsonObject { put("error", e.message ?: "reseau") }
        }
    }

    /* ---------------------------------------------------- la session */

    fun show(visible: Boolean) {
        _ui.value = _ui.value.copy(visible = visible)
    }

    fun dismiss() {
        if (!_ui.value.running) _ui.value = Ui()
    }

    fun stop() {
        job?.cancel()
        piloting = false
        userDone?.complete(false)
        _ui.value = _ui.value.copy(running = false, step = null, needsUser = false, teach = false)
        scope.launch(Dispatchers.Main) { runCatching { web?.loadUrl("about:blank") } }
    }

    /** Apres un defi resolu a la main : on reprend le jeu en cours. */
    fun userFinished(retry: Boolean) {
        userDone?.complete(retry)
    }

    /**
     * Ta reponse sur le panneau « montre-moi le bouton » (1.24.0) : le jeu est deja a toi, ou n'est plus
     * offert. L'offre est close, on ne la redemande plus.
     */
    fun answer(kind: String) {
        if (kind != Verdicts.OWNED && kind != Verdicts.GONE) return
        teachAnswer = kind
        userDone?.complete(false)
    }

    /**
     * Tout ce qui reste a prendre -- ou seulement `keys`, qui passent alors
     * outre le recul (le bouton « Recuperer » d'une carte).
     */
    /**
     * Tout ce qui reste a prendre -- ou seulement `keys`, qui passent alors
     * outre le recul. Rend faux si la recuperation de fond tient deja la
     * main : jamais deux pages pilotees a la fois sur un meme compte.
     */
    fun start(keys: Set<String> = emptySet()): Boolean {
        if (_ui.value.running) return true
        forced = true
        targeted = keys
        val now = System.currentTimeMillis()
        val s = Graph.store.value
        val todo = Rules.pending(s, now, force = keys).let { list -> if (keys.isEmpty()) list else list.filter { it.key in keys } }
        if (todo.isEmpty()) {
            _ui.value = Ui(outcomes = emptyList(), visible = false)
            return true
        }
        if (!Graph.claimLock.tryLock()) return false
        _ui.value = Ui(running = true, total = todo.size, visible = true)
        job = scope.launch {
            try {
                runAll(todo)
            } finally {
                Graph.claimLock.unlock()
            }
        }
        return true
    }

    /** Toute la famille (1.9.0) : la meme boucle, a l'ecran, pour un membre. Le verrou est tenu par l'appelant. */
    suspend fun runShown(todo: List<Offer>): List<String> {
        forced = true
        _ui.value = Ui(running = true, total = todo.size, visible = true)
        return runAll(todo)
    }

    /**
     * La boucle, pour l'ecran comme pour le fond. `deadline` : l'heure apres
     * laquelle on n'entame plus de jeu (le fond a dix minutes en tout).
     * Rend les titres obtenus.
     */
    suspend fun runAll(todo: List<Offer>, deadline: Long = Long.MAX_VALUE): List<String> {
        val blocked = mutableSetOf<String>()
        var steamDone = 0
        val won = mutableListOf<String>()
        // Un membre sans profil separe : jamais dans la session du compte principal.
        if (member != null && !Family.supported()) return won
        val family = member != null
        // Le relais d'abord : ce que le PC vient de prendre n'est pas retente.
        if (!family) runCatchingSuspend { RelayLink.sync(context, System.currentTimeMillis()) }
        // L'historique des commandes Epic se lit UNE fois pour tout ce passage, pas une fois par offre (1.26.0).
        val ownerMemo = OwnedCheck.Memo()
        try {
            for ((i, offer) in todo.withIndex()) {
                if (System.currentTimeMillis() > deadline) break
                val st = Graph.store.value
                val m = Family.member(st, member)
                if (family && m == null) break
                if (Rules.claimedEntry(offer, m?.library ?: st.library) != null) continue
                if (!family && Relay.held(st, offer, System.currentTimeMillis())) continue
                if (offer.store in blocked) {
                    record(offer, Verdicts.LOGIN, "session a reprendre", count = false)
                    continue
                }
                /* DEJA A TOI ? On le demande au magasin avant d'ouvrir la moindre page (1.24.0) : un jeu pris a la
                   main, ou que la page ne dit plus « a toi » (« Jouer »), ne rouvre rien et ne redemande rien. */
                if (!family && offer.store in OwnedCheck.ORACLE_STORES) {
                    val preuve = OwnedCheck.accountOwns(Graph.http, offer, st.owned, ownerMemo) { reading -> noteReading(offer.store, reading) }
                    if (preuve != null) {
                        recordOwned(offer, preuve.note)
                        continue
                    }
                }
                _ui.value = _ui.value.copy(title = offer.shownTitle, store = offer.store, index = i + 1, step = null, needsUser = false)
                if (headless) Notifier.working(context, offer.shownTitle, i + 1, todo.size)
                if (!family) runCatchingSuspend { RelayLink.lock(context, offer, System.currentTimeMillis()) }
                var result = runOne(offer, steamDone)
                if (result.first == Verdicts.CHALLENGE) {
                    if (headless) {
                        // Jamais resolu par l'appli : l'humain est appele, et le jeu attend.
                        // Le PC l'apprend aussi (1.4.0) : il tentera ce jeu a son prochain cycle.
                        if (family) Notifier.familyChallenge(context, m!!.name, offer)
                        else {
                            Notifier.challenge(context, offer)
                            runCatchingSuspend { RelayLink.help(context, offer, System.currentTimeMillis()) }
                        }
                    } else {
                        _ui.value = _ui.value.copy(needsUser = true, visible = true)
                        userDone = CompletableDeferred()
                        val retry = userDone!!.await()
                        _ui.value = _ui.value.copy(needsUser = false)
                        if (retry) result = runOne(offer, steamDone)
                    }
                }
                if (result.first == Verdicts.TEACH) {
                    if (headless) {
                        // Personne devant l'ecran : on previent, et le jeu attend qu'on lui montre le bouton.
                        if (!family) Notifier.teach(context, offer)
                    } else {
                        // La page reste ouverte : un clic de l'utilisateur apprend le bouton au moteur (qui previent par fgc-appris).
                        _ui.value = _ui.value.copy(needsUser = true, teach = true, visible = true)
                        teachAnswer = null
                        userDone = CompletableDeferred()
                        val retry = userDone!!.await()
                        _ui.value = _ui.value.copy(needsUser = false, teach = false)
                        // Ta reponse : « deja a moi » ou « plus offert » -- l'offre est close, la question ne revient pas.
                        val reponse = teachAnswer
                        teachAnswer = null
                        if (reponse == Verdicts.OWNED) {
                            recordOwned(offer, "tu as dit : deja a toi")
                            continue
                        }
                        if (reponse == Verdicts.GONE) {
                            record(offer, Verdicts.GONE, "tu as dit : plus offert", confirmed = true)
                            continue
                        }
                        if (retry) result = runOne(offer, steamDone)
                    }
                }
                if (offer.store == Stores.STEAM && result.first != "steam-gate") steamDone++
                if (result.first == "steam-gate") continue
                record(offer, result.first, result.second)
                if (result.first == Verdicts.LOGIN) {
                    blocked += offer.store
                    Notifier.login(context, offer.store, m?.name)
                }
                if (result.first in Verdicts.ACQUIRED) {
                    won += offer.shownTitle
                    if (!family && result.first != Verdicts.ALREADY_REDEEMED) {
                        runCatchingSuspend { RelayLink.claimed(context, offer, result.first, System.currentTimeMillis()) }
                    }
                }
            }
        } finally {
            piloting = false
            if (web != null) withContext(kotlinx.coroutines.NonCancellable + Dispatchers.Main) { runCatching { web?.loadUrl("about:blank") } }
            _ui.value = _ui.value.copy(running = false, step = null, title = null)
            if (headless) Notifier.doneWorking(context)
        }
        Notifier.claimed(context, won, memberName)
        return won
    }

    /** Le magasin s'est-il laisse lire ? Note pour la page « Sante » (1.26.0), sans bloquer quoi que ce soit. */
    private suspend fun noteReading(store: String, reading: OwnedCheck.Reading) {
        val note = OracleNote(System.currentTimeMillis(), reading == OwnedCheck.Reading.READ)
        Graph.store.update { s -> s.copy(oracle = s.oracle + (store to note)) }
    }

    /** Le jeu est a toi (le compte du magasin, ou toi, l'a dit) : l'offre est close et le jeu memorise (1.24.0). */
    private suspend fun recordOwned(o: Offer, note: String) {
        val now = System.currentTimeMillis()
        record(o, Verdicts.OWNED, note)
        if (member == null) Graph.store.update { s -> s.copy(deja = Rules.remember(s.deja, o, now)) }
    }

    private suspend fun record(o: Offer, verdictName: String, details: String?, count: Boolean = true, confirmed: Boolean = false) {
        val now = System.currentTimeMillis()
        _ui.value = _ui.value.copy(outcomes = _ui.value.outcomes + Outcome(o.key, o.shownTitle, o.store, verdictName, details))
        if (member != null) {
            Graph.store.update { Family.record(it, member, o, verdictName, details, now, unattended = headless, count = count, confirmed = confirmed) }
            return
        }
        Graph.store.update { s ->
            val att = if (count) Rules.afterVerdict(s.attempts[o.key], verdictName, details, now, unattended = headless, confirmed = confirmed) else s.attempts[o.key]
            var lib = s.library
            var accounts = s.accounts
            if (verdictName in Verdicts.ACQUIRED) {
                val entry = LibraryEntry(
                    store = o.store, id = o.storeId ?: o.sourceId ?: o.normalisedTitle, title = o.shownTitle,
                    url = o.url, worth = o.worth, image = o.image, ts = now, status = verdictName,
                    wsrc = Bargain.worthSource(o),
                )
                lib = lib + (Rules.libraryKeyOf(o) to entry)
                accounts = accounts + (o.store to AccountState(Accounts.OK, now, via = Accounts.PAGE))
            }
            if (verdictName == Verdicts.LOGIN) accounts = accounts + (o.store to AccountState(Accounts.LOGGED_OUT, now, via = Accounts.PAGE))
            s.copy(attempts = if (att != null) s.attempts + (o.key to att) else s.attempts, library = lib, accounts = accounts)
        }
    }

    private suspend fun runOne(o: Offer, steamDone: Int): Pair<String, String?> = try {
        if (o.store == Stores.STEAM) claimSteam(o, steamDone) else claimWithEngine(o)
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (e: Exception) {
        Verdicts.FAILURE to (e.message ?: e.toString())
    }

    private suspend fun load(url: String, timeoutMs: Long = LOAD_WAIT_MS): String? {
        val d = CompletableDeferred<String>()
        pageLoad = d
        withContext(Dispatchers.Main) { webView.loadUrl(url) }
        return withTimeoutOrNull(timeoutMs) { d.await() }
    }

    private suspend fun nextLoad(timeoutMs: Long): String? {
        val d = CompletableDeferred<String>()
        pageLoad = d
        return withTimeoutOrNull(timeoutMs) { d.await() }
    }

    private suspend fun eval(js: String): String? = withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { c -> webView.evaluateJavascript(js) { if (c.isActive) c.resume(it) } }
    }

    /* ---------------------------------------- Epic, GOG, Amazon : le moteur */

    private suspend fun claimWithEngine(o: Offer): Pair<String, String?> {
        val raw = o.url ?: o.resolveUrl ?: return Verdicts.BAD_URL to "aucune page a ouvrir"
        // La page s'ouvre dans la langue du pays choisi (GOG en /fr/, Epic en ?lang=fr, Luna sur son domaine) : c'est elle que le moteur lit.
        val target = Localize.url(raw, Graph.store.value.settings.country, forClaim = true) ?: raw
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            return Verdicts.FAILURE to "WebView trop ancienne : mettez a jour « Android System WebView »"
        }
        piloting = true
        ready = CompletableDeferred()
        verdict = CompletableDeferred()
        _ui.value = _ui.value.copy(step = STEP_OPEN)
        load(target)
        _ui.value = _ui.value.copy(step = STEP_WAIT)
        val pret = withTimeoutOrNull(READY_WAIT_MS) { ready!!.await() }
        if (pret == null) {
            val landed = currentUrl
            val store = Titles.storeFromUrl(landed)
            if (o.url == null && (store == null || store !in Stores.ENGINE)) return Verdicts.OUT_OF_SCOPE to (landed ?: "?")
            return Verdicts.FAILURE to "le moteur ne s'est pas annonce"
        }
        _ui.value = _ui.value.copy(step = STEP_CLAIM)
        val budget = if (headless) HEADLESS_BUDGET_MS else BUDGET_MS
        val order = buildJsonObject { put("push", buildJsonObject { put("type", "fgc-reclame"); put("budgetMs", budget); put("force", forced)
            // Devant l'ecran : demander tout de suite -- UNE fois par offre (1.24.0), sauf si c'est toi qui as touche
            // « Recuperer » sur elle ; en fond : jamais (personne pour cliquer).
            val dejaDemande = Rules.alreadyAsked(Graph.store.value.attempts[o.key]) && o.key !in targeted
            if (headless || dejaDemande) put("teach", false) else put("teach", "now")
        }) }.toString()
        withContext(Dispatchers.Main) { mainProxy?.postMessage(order) }
        val v = withTimeoutOrNull(budget + 10_000) { verdict!!.await() }
            ?: return Verdicts.FAILURE to "aucun verdict en ${budget / 1000} s"
        val name = v["verdict"].str ?: Verdicts.UNDETERMINED
        return name to v["reasonText"].str
    }

    /* ------------------------------------------------------ Steam */

    private suspend fun ownership(now: Long): Pair<String, Pair<Set<String>, Set<String>>?> = try {
        val r = Graph.http.get("${SteamSource.OWNED_URL}?t=$now", withCookies = true)
        val owned = if (r.ok) SteamSource.parseOwned(r.body) else null
        when {
            owned == null -> "error" to null
            owned.first.isEmpty() && owned.second.isEmpty() -> "logged_out" to null
            else -> "ok" to owned
        }
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (_: Exception) {
        "error" to null
    }

    /**
     * Lent a dessein, comme watch/steam-claim.js (steamGate) : une par
     * passage, vingt minutes d'ecart, six par jour au plus.
     */
    private fun steamGate(now: Long, doneThisRun: Int): String? {
        if (doneThisRun >= 1) return "une recuperation Steam par passage"
        val recent = Graph.store.value.let { s ->
            s.attempts.filterKeys { k -> s.offers[k]?.store == Stores.STEAM }.values.map { it.lastAt }.filter { now - it < 24 * 3_600_000L }
        }
        val last = recent.maxOrNull()
        if (last != null && now - last < 20 * 60_000L) return "derniere recuperation Steam il y a ${(now - last) / 60_000} min"
        if (recent.size >= 6) return "${recent.size} recuperations Steam en 24 h"
        return null
    }

    private suspend fun claimSteam(o: Offer, doneThisRun: Int): Pair<String, String?> {
        val now = System.currentTimeMillis()
        val pkg = o.packageId ?: return Verdicts.FAILURE to "paquet Steam inconnu"
        val appid = o.storeId ?: return Verdicts.FAILURE to "application Steam inconnue"
        steamGate(now, doneThisRun)?.let { return "steam-gate" to it }

        val (status, owned) = ownership(now)
        if (status == "logged_out") return Verdicts.LOGIN to "Steam demande la connexion"
        if (owned != null && (pkg in owned.second || appid in owned.first)) return Verdicts.CLAIMED to "deja dans la bibliotheque Steam"
        val base = o.parentAppid
        if (base != null && owned != null && base !in owned.first) return Verdicts.NEEDS_BASE to base

        piloting = false
        _ui.value = _ui.value.copy(step = STEP_OPEN)
        val landed = load("https://store.steampowered.com/app/$appid/?l=english")
            ?: return Verdicts.FAILURE to "la page Steam n'a pas fini de charger"
        if (Regex("^https://store\\.steampowered\\.com/agecheck/", RegexOption.IGNORE_CASE).containsMatchIn(landed)) {
            return Verdicts.FAILURE to "controle d'age Steam : a passer une fois a la main"
        }
        if (Regex("^https://(store\\.steampowered\\.com|steamcommunity\\.com)/login\\b", RegexOption.IGNORE_CASE).containsMatchIn(landed)) {
            return Verdicts.LOGIN to "Steam demande la connexion"
        }
        _ui.value = _ui.value.copy(step = STEP_CLAIM)
        val raw = eval("(function(){\n$steamModule\nreturn steamPageStep(${JSON.encodeToString(JsonPrimitive.serializer(), JsonPrimitive(pkg))}, false);\n})()")
        val step = parseJson(raw)
        if (step["ok"].bool != true) {
            return when (step["reason"].str) {
                "deja-possede" -> Verdicts.CLAIMED to "Steam dit : deja dans la bibliotheque"
                "non-connecte" -> Verdicts.LOGIN to "la page Steam n'est pas connectee"
                else -> Verdicts.FAILURE to "page Steam : ${step["reason"].str ?: raw?.take(120)}"
            }
        }
        nextLoad(25_000)
        repeat(3) { i ->
            delay(2_000L * (i + 1))
            val (_, after) = ownership(System.currentTimeMillis())
            if (after != null && pkg in after.second) return Verdicts.CLAIMED to null
        }
        val motif = eval("(function(){\n$steamModule\nreturn steamErrorText();\n})()")?.let { parseJson(it).str }.orEmpty()
        if (Regex("base (product|game)", RegexOption.IGNORE_CASE).containsMatchIn(motif)) return Verdicts.NEEDS_BASE to motif
        return Verdicts.FAILURE to (if (motif.isNotEmpty()) "Steam : $motif" else "la bibliotheque ne montre pas le paquet")
    }

    fun release() {
        web?.let { runCatching { it.destroy() } }
    }

    companion object {
        const val STEP_OPEN = "open"
        const val STEP_WAIT = "wait"
        const val STEP_CLAIM = "claim"

        const val LOAD_WAIT_MS = 45_000L
        const val READY_WAIT_MS = 60_000L
        const val BUDGET_MS = 5 * 60_000L
        /** Le fond a dix minutes en tout (WorkManager) : un jeu en prend quatre au plus. */
        const val HEADLESS_BUDGET_MS = 4 * 60_000L
        /** Apres trois minutes, le fond n'entame plus de jeu : le reste passe au tour suivant. */
        const val HEADLESS_START_WINDOW_MS = 3 * 60_000L

        /** Les pages ou le moteur est injecte : celles de l'extension (manifest.json). */
        val ORIGINS = setOf(
            "https://*.epicgames.com",
            "https://www.gog.com",
            "https://gog.com",
            "https://gaming.amazon.com",
            "https://luna.amazon.com", "https://luna.amazon.fr", "https://luna.amazon.de", "https://luna.amazon.co.uk",
            "https://luna.amazon.it", "https://luna.amazon.es", "https://luna.amazon.ca", "https://luna.amazon.com.au",
            "https://luna.amazon.co.jp", "https://luna.amazon.in", "https://luna.amazon.com.mx", "https://luna.amazon.com.br",
            "https://luna.amazon.nl", "https://luna.amazon.se", "https://luna.amazon.pl", "https://luna.amazon.com.tr",
        )

        private val ALLOWED_FETCH = listOf("epicgames.com", "gog.com", "gamerpower.com", "steampowered.com")

        /** Seul le web s'ouvre au-dehors : une adresse venue d'une source ne lance jamais une autre appli. */
        fun openExternally(context: Context, url: String) {
            val web = Titles.webUrl(url)?.let { Localize.url(it, Graph.store.value.settings.country) ?: it } ?: return
            runCatching {
                context.startActivity(
                    android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(web))
                        .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
        }
    }
}
