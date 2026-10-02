package io.github.diaslamka.freegames.data

import android.content.Context
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.bool
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.num
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * La mise a jour de l'appli, depuis l'appli (1.20.0).
 *
 * Jusqu'ici : ouvrir GitHub dans le navigateur, telecharger l'APK, l'ouvrir,
 * installer. Ici : l'appli lit les versions publiees, telecharge la plus
 * recente, la verifie, et la passe au systeme pour l'installer par-dessus.
 *
 * CE QUI LA PROTEGE
 *   - La version vient des publications du depot (`app-vX.Y.Z`), jamais d'une
 *     adresse donnee par ailleurs ; le telechargement ne suit une redirection
 *     que vers github.com ou githubusercontent.com, en https, et SANS le jeton.
 *   - Le fichier est verifie : taille, SHA-256 publie avec la version, et --
 *     surtout -- sa SIGNATURE doit etre celle de l'appli installee (`Install`
 *     le verifie avant de proposer quoi que ce soit). Android la reverifie a
 *     l'installation : un APK signe par une autre cle ne s'installe pas.
 *   - Rien ne s'installe en arriere-plan : la veille PREVIENT (notification),
 *     l'installation se declenche depuis l'ecran des reglages.
 *
 * LE DEPOT EST PRIVE. Sans jeton, GitHub repond 404 aux versions d'un depot
 * prive. Le jeton est facultatif : un jeton a grain fin, en LECTURE SEULE, sur ce
 * seul depot (« Contents : Read-only »). Il reste chiffre par le Keystore, ne
 * part que vers api.github.com, et n'est ni dans l'export ni dans une sauvegarde
 * (voir UpdateToken).
 */
object AppUpdate {
    const val REPO = "diasLamka/free-games-claimer-extension"
    const val TAG_PREFIX = "app-v"
    private const val API = "https://api.github.com/repos/$REPO"
    private const val MAX_BYTES = 60L * 1024 * 1024

    data class Release(
        val version: String,
        val tag: String,
        val assetId: Long,
        val name: String,
        val size: Long,
        val sha256: String?,
        val notes: String,
    )

    enum class Reason { NETWORK, PRIVATE, RATE_LIMIT, NO_RELEASE, BAD_FILE, WRONG_APP, INSTALL }

    sealed interface Status {
        data object Idle : Status
        data object Checking : Status
        data class UpToDate(val version: String) : Status
        data class Available(val release: Release) : Status
        data class Downloading(val release: Release, val percent: Int) : Status
        data object Installing : Status
        data class Failed(val reason: Reason, val detail: String? = null) : Status
    }

    /** Ce que l'ecran affiche ; un seul etat pour toute l'appli. */
    val status = MutableStateFlow<Status>(Status.Idle)

    /* ------------------------------------------------------------ versions */

    /** « 1.19.0 » ou « app-v1.19.0 » : les nombres, ou null si ce n'est pas une version. */
    fun parseVersion(raw: String?): List<Int>? {
        val v = raw?.trim()?.removePrefix(TAG_PREFIX)?.removePrefix("v") ?: return null
        if (!Regex("""^\d+(\.\d+){1,3}$""").matches(v)) return null
        return v.split('.').map { it.toIntOrNull() ?: return null }
    }

    /** Compare deux versions numeriquement : « 1.10.0 » est plus recente que « 1.9.0 ». */
    fun compare(a: String, b: String): Int {
        val x = parseVersion(a) ?: return 0
        val y = parseVersion(b) ?: return 0
        for (i in 0 until maxOf(x.size, y.size)) {
            val d = (x.getOrElse(i) { 0 }).compareTo(y.getOrElse(i) { 0 })
            if (d != 0) return d
        }
        return 0
    }

    fun isNewer(candidate: String, current: String): Boolean = compare(candidate, current) > 0

    private val BODY_HASH = Regex("""SHA-256[^`\n]*`([0-9a-fA-F]{64})`""")

    /**
     * La version la plus recente parmi les publications, ou null. Une
     * publication brouillon ou pre-publication est ignoree, comme tout tag qui
     * n'est pas `app-v*` et toute publication sans APK de l'appli.
     */
    fun pickRelease(json: String?): Release? {
        val list = parseJson(json).arr ?: return null
        var best: Release? = null
        for (r in list) {
            if (r["draft"].bool == true || r["prerelease"].bool == true) continue
            val tag = r["tag_name"].str ?: continue
            if (!tag.startsWith(TAG_PREFIX)) continue
            val version = parseVersion(tag)?.joinToString(".") ?: continue
            val asset = r["assets"].arr?.firstOrNull {
                val n = it["name"].str.orEmpty()
                n.endsWith(".apk") && n.startsWith("free-games-claimer-android") && it["state"].str.let { s -> s == null || s == "uploaded" }
            } ?: continue
            val id = asset["id"].num?.toLong() ?: continue
            val notes = r["body"].str.orEmpty()
            val digest = asset["digest"].str?.removePrefix("sha256:")?.takeIf { it.length == 64 }
                ?: BODY_HASH.find(notes)?.groupValues?.get(1)
            val candidate = Release(
                version = version, tag = tag, assetId = id, name = asset["name"].str.orEmpty(),
                size = asset["size"].num?.toLong() ?: -1L, sha256 = digest?.lowercase(), notes = notes,
            )
            if (best == null || compare(candidate.version, best.version) > 0) best = candidate
        }
        return best
    }

    /* -------------------------------------------------------------- reseau */

    /** La liste des versions : le code HTTP, le corps, et si GitHub dit « trop de requetes ». */
    data class Listing(val code: Int, val body: String, val rateLimited: Boolean = false) {
        val ok: Boolean get() = code in 200..299
    }

    /** Le reseau de la mise a jour : deux appels, remplacables dans les tests. */
    interface Net {
        suspend fun releases(token: String?): Listing

        /** Telecharge l'APK `assetId` dans `dest`. Rend le code HTTP ; `onProgress(lu, total)`. */
        suspend fun download(assetId: Long, token: String?, dest: File, onProgress: (Long, Long) -> Unit): Int
    }

    class OkNet(
        private val client: OkHttpClient,
        private val api: String = API,
        private val trust: (String?) -> Boolean = ::trustedRedirect,
    ) : Net {
        private val plain: OkHttpClient = client.newBuilder()
            .followRedirects(false)
            .followSslRedirects(false)
            .readTimeout(60, TimeUnit.SECONDS)
            .callTimeout(10, TimeUnit.MINUTES)
            .build()

        private fun base(url: String, accept: String, token: String?): Request.Builder {
            val b = Request.Builder().url(url)
                .header("User-Agent", "FreeGamesClaimer-Android")
                .header("Accept", accept)
                .header("X-GitHub-Api-Version", "2022-11-28")
            if (!token.isNullOrBlank()) b.header("Authorization", "Bearer ${token.trim()}")
            return b
        }

        override suspend fun releases(token: String?): Listing = withContext(Dispatchers.IO) {
            client.newCall(base("$api/releases?per_page=15", "application/vnd.github+json", token).build()).execute().use { r ->
                Listing(r.code, r.body.string(), rateLimited = r.header("x-ratelimit-remaining") == "0")
            }
        }

        override suspend fun download(assetId: Long, token: String?, dest: File, onProgress: (Long, Long) -> Unit): Int =
            withContext(Dispatchers.IO) {
                var resp = plain.newCall(base("$api/releases/assets/$assetId", "application/octet-stream", token).build()).execute()
                if (resp.code in 301..308) {
                    val next = resp.header("Location")
                    resp.close()
                    if (!trust(next)) return@withContext 0
                    // L'adresse signee suffit : le jeton, lui, ne sort pas de api.github.com.
                    resp = plain.newCall(base(next!!, "application/octet-stream", null).build()).execute()
                }
                resp.use { r ->
                    if (!r.isSuccessful) return@use r.code
                    val total = r.body.contentLength()
                    if (total > MAX_BYTES) return@use 0
                    dest.parentFile?.mkdirs()
                    var done = 0L
                    r.body.byteStream().use { input ->
                        dest.outputStream().use { out ->
                            val buf = ByteArray(64 * 1024)
                            while (true) {
                                val n = input.read(buf)
                                if (n < 0) break
                                done += n
                                if (done > MAX_BYTES) throw IOException("fichier trop gros")
                                out.write(buf, 0, n)
                                onProgress(done, total)
                            }
                        }
                    }
                    r.code
                }
            }
    }

    /** Une redirection de telechargement n'est suivie que vers GitHub, en https. */
    fun trustedRedirect(url: String?): Boolean {
        val u = url?.let { try { java.net.URI(it) } catch (_: Exception) { null } } ?: return false
        val host = u.host?.lowercase() ?: return false
        return u.scheme == "https" && (host == "github.com" || host.endsWith(".github.com") || host.endsWith(".githubusercontent.com"))
    }

    /* --------------------------------------------------------------- etapes */

    fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** Cherche une version plus recente que `current`. Le resultat est aussi publie dans `status`. */
    suspend fun check(net: Net, token: String?, current: String): Status {
        status.value = Status.Checking
        val result: Status = try {
            val r = net.releases(token)
            when {
                r.ok -> {
                    val best = pickRelease(r.body)
                    when {
                        best == null -> Status.Failed(Reason.NO_RELEASE)
                        isNewer(best.version, current) -> Status.Available(best)
                        else -> Status.UpToDate(current)
                    }
                }
                // Un depot prive repond 404 (ou 401) a qui n'a pas de jeton valable.
                r.code == 404 || r.code == 401 -> Status.Failed(Reason.PRIVATE)
                r.code == 403 && r.rateLimited -> Status.Failed(Reason.RATE_LIMIT)
                r.code == 403 -> Status.Failed(Reason.PRIVATE)
                else -> Status.Failed(Reason.NETWORK, "HTTP ${r.code}")
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Status.Failed(Reason.NETWORK, e.message?.take(80))
        }
        status.value = result
        return result
    }

    /**
     * Telecharge et verifie l'APK de `release` dans `dir` (le cache de l'appli).
     * Rend le fichier pret a installer, ou null (l'echec est dans `status`). Le
     * fichier d'une verification ratee est supprime. `verify` dit si c'est bien
     * une version de CETTE appli (Install.sameApp).
     */
    suspend fun fetch(dir: File, net: Net, token: String?, release: Release, verify: (File) -> Boolean): File? {
        dir.mkdirs()
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, release.name)
        status.value = Status.Downloading(release, 0)
        try {
            var last = -1
            val code = net.download(release.assetId, token, file) { done, total ->
                val pct = if (total > 0) (done * 100 / total).toInt() else 0
                if (pct != last) { last = pct; status.value = Status.Downloading(release, pct) }
            }
            if (code == 404 || code == 401 || code == 403) return fail(file, Reason.PRIVATE)
            if (code !in 200..299) return fail(file, Reason.NETWORK, "HTTP $code")
        } catch (e: kotlinx.coroutines.CancellationException) {
            file.delete()
            throw e
        } catch (e: Exception) {
            return fail(file, Reason.NETWORK, e.message?.take(80))
        }
        if (release.size > 0 && file.length() != release.size) return fail(file, Reason.BAD_FILE, "taille")
        val expected = release.sha256
        if (expected != null && sha256(file) != expected) return fail(file, Reason.BAD_FILE, "SHA-256")
        if (!verify(file)) return fail(file, Reason.WRONG_APP)
        return file
    }

    private fun fail(file: File, reason: Reason, detail: String? = null): File? {
        file.delete()
        status.value = Status.Failed(reason, detail)
        return null
    }

    /* ----------------------------------------- la veille : prevenir, une fois */

    private const val PREFS = "maj"
    private const val CHECK_EVERY_MS = 24L * 3_600_000

    /**
     * Appelee par la veille de fond. Cherche au plus une fois par jour ; si une
     * version plus recente existe et que l'utilisateur n'en a pas deja ete
     * prevenu, rend cette version (la veille envoie la notification).
     */
    suspend fun backgroundCheck(context: Context, net: Net, token: String?, current: String, now: Long): Release? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (now - prefs.getLong("derniere", 0L) < CHECK_EVERY_MS) return null
        prefs.edit().putLong("derniere", now).apply()
        val st = check(net, token, current)
        val release = (st as? Status.Available)?.release ?: return null
        if (prefs.getString("prevenu", null) == release.version) return null
        prefs.edit().putString("prevenu", release.version).apply()
        return release
    }
}
