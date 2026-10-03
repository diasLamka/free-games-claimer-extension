package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.AppUpdate
import io.github.diaslamka.freegames.data.AppUpdate.Reason
import io.github.diaslamka.freegames.data.AppUpdate.Status
import io.github.diaslamka.freegames.data.Install
import io.github.diaslamka.freegames.data.Install.Silence
import io.github.diaslamka.freegames.data.UpdateToken
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.security.MessageDigest

/**
 * La mise a jour depuis l'appli (1.20.0) : quelle version, laquelle est plus
 * recente, que fait-on d'un fichier abime, et ce qui ne doit JAMAIS arriver
 * (suivre une redirection hors de GitHub, installer un fichier qui n'est pas
 * le bon).
 */
class UpdateTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private val apk = "contenu de l'apk".toByteArray()

    private fun release(tag: String, asset: String = "free-games-claimer-android-X.apk", extra: String = "", body: String = "", draft: Boolean = false, pre: Boolean = false, id: Long = 1) =
        """{"tag_name":"$tag","draft":$draft,"prerelease":$pre,"body":"$body","assets":[{"id":$id,"name":"$asset","size":${apk.size},"state":"uploaded"$extra}]}"""

    private fun list(vararg r: String) = "[" + r.joinToString(",") + "]"

    /* ------------------------------------------------------------ versions */

    @Test
    fun versionsCompareAsNumbersNotAsText() {
        assertTrue(AppUpdate.isNewer("1.10.0", "1.9.0"))
        assertTrue(AppUpdate.isNewer("app-v1.19.1", "1.19.0"))
        assertTrue(AppUpdate.isNewer("2.0", "1.99.9"))
        assertFalse(AppUpdate.isNewer("1.19.0", "1.19.0"))
        assertFalse(AppUpdate.isNewer("1.18.0", "1.19.0"))
        assertFalse(AppUpdate.isNewer("n'importe quoi", "1.19.0"))
        assertEquals(listOf(1, 19, 0), AppUpdate.parseVersion("app-v1.19.0"))
        assertNull(AppUpdate.parseVersion("1.x.0"))
        assertNull(AppUpdate.parseVersion(null))
    }

    @Test
    fun theNewestAppReleaseWinsAndEverythingElseIsIgnored() {
        val json = list(
            release("app-v1.18.0", "free-games-claimer-android-1.18.0.apk", id = 18),
            release("app-v1.20.0", "free-games-claimer-android-1.20.0.apk", id = 20),
            release("app-v1.21.0", "free-games-claimer-android-1.21.0.apk", id = 21, draft = true),
            release("app-v1.22.0", "free-games-claimer-android-1.22.0.apk", id = 22, pre = true),
            release("v2.101.0", "extension.zip", id = 99),
            release("app-v1.23.0", "autre-chose.apk", id = 23),
            release("app-v1.24.0", "free-games-claimer-android-1.24.0.zip", id = 24),
        )
        val best = AppUpdate.pickRelease(json)
        assertNotNull(best)
        assertEquals("1.20.0", best!!.version)
        assertEquals(20L, best.assetId)
        assertNull(AppUpdate.pickRelease("[]"))
        assertNull(AppUpdate.pickRelease("pas du json"))
        assertNull(AppUpdate.pickRelease(null))
    }

    @Test
    fun theHashComesFromTheAssetOrFromTheReleaseNotes() {
        val h = sha(apk)
        assertEquals(h, AppUpdate.pickRelease(list(release("app-v1.20.0", extra = ",\"digest\":\"sha256:$h\"")))!!.sha256)
        val notes = "- SHA-256 de l'APK : `${h.uppercase()}`\\n- Certificat"
        assertEquals(h, AppUpdate.pickRelease(list(release("app-v1.20.0", body = notes)))!!.sha256)
        assertNull(AppUpdate.pickRelease(list(release("app-v1.20.0")))!!.sha256)
    }

    /* ------------------------------------------------------------ recherche */

    private class FakeNet(
        var listing: AppUpdate.Listing = AppUpdate.Listing(200, "[]"),
        var code: Int = 200,
        var bytes: ByteArray = ByteArray(0),
        var fail: Exception? = null,
    ) : AppUpdate.Net {
        var tokenSeen: String? = "jamais appele"
        override suspend fun releases(token: String?): AppUpdate.Listing {
            tokenSeen = token
            fail?.let { throw it }
            return listing
        }
        override suspend fun download(assetId: Long, token: String?, dest: File, onProgress: (Long, Long) -> Unit): Int {
            tokenSeen = token
            fail?.let { throw it }
            if (code in 200..299) { dest.writeBytes(bytes); onProgress(bytes.size.toLong(), bytes.size.toLong()) }
            return code
        }
    }

    @Test
    fun aNewerVersionIsAvailableAndTheSameOneIsUpToDate() = runBlocking {
        val net = FakeNet(AppUpdate.Listing(200, list(release("app-v1.20.0", "free-games-claimer-android-1.20.0.apk"))))
        assertTrue(AppUpdate.check(net, null, "1.19.0") is Status.Available)
        assertEquals(Status.UpToDate("1.20.0"), AppUpdate.check(net, null, "1.20.0"))
        assertEquals(Status.UpToDate("1.21.0"), AppUpdate.check(net, null, "1.21.0"))
        assertEquals(AppUpdate.status.value, Status.UpToDate("1.21.0"))
    }

    @Test
    fun aPrivateRepositoryWithoutTokenSaysSoInsteadOfPretendingNothingIsNew() = runBlocking {
        assertEquals(Status.Failed(Reason.PRIVATE), AppUpdate.check(FakeNet(AppUpdate.Listing(404, "{}")), null, "1.19.0"))
        assertEquals(Status.Failed(Reason.PRIVATE), AppUpdate.check(FakeNet(AppUpdate.Listing(401, "{}")), "jeton", "1.19.0"))
        assertEquals(Status.Failed(Reason.RATE_LIMIT), AppUpdate.check(FakeNet(AppUpdate.Listing(403, "{}", rateLimited = true)), null, "1.19.0"))
        assertEquals(Status.Failed(Reason.PRIVATE), AppUpdate.check(FakeNet(AppUpdate.Listing(403, "{}")), null, "1.19.0"))
        assertEquals(Status.Failed(Reason.NO_RELEASE), AppUpdate.check(FakeNet(AppUpdate.Listing(200, "[]")), null, "1.19.0"))
        assertEquals(Status.Failed(Reason.NETWORK, "HTTP 502"), AppUpdate.check(FakeNet(AppUpdate.Listing(502, "")), null, "1.19.0"))
        assertEquals(Status.Failed(Reason.NETWORK, "plus de reseau"), AppUpdate.check(FakeNet(fail = IOException("plus de reseau")), null, "1.19.0"))
    }

    @Test
    fun theTokenIsHandedToTheNetworkAndNothingElse() = runBlocking {
        val net = FakeNet(AppUpdate.Listing(200, "[]"))
        AppUpdate.check(net, "github_pat_exemple", "1.19.0")
        assertEquals("github_pat_exemple", net.tokenSeen)
        AppUpdate.check(net, null, "1.19.0")
        assertNull(net.tokenSeen)
    }

    /* ---------------------------------------------------------- telechargement */

    private fun rel(sha: String? = sha(apk), size: Long = apk.size.toLong()) =
        AppUpdate.Release("1.20.0", "app-v1.20.0", 20, "free-games-claimer-android-1.20.0.apk", size, sha, "")

    @Test
    fun aGoodFileIsKept() = runBlocking {
        val dir = File(tmp.root, "maj")
        val file = AppUpdate.fetch(dir, FakeNet(bytes = apk), null, rel()) { true }
        assertNotNull(file)
        assertTrue(file!!.exists())
        assertEquals(sha(apk), AppUpdate.sha256(file))
    }

    @Test
    fun aDamagedOrWrongFileIsDeletedAndNeverHandedToTheInstaller() = runBlocking {
        val dir = File(tmp.root, "maj")
        // Mauvais SHA-256.
        assertNull(AppUpdate.fetch(dir, FakeNet(bytes = "autre".toByteArray()), null, rel(size = -1)) { true })
        assertEquals(Status.Failed(Reason.BAD_FILE, "SHA-256"), AppUpdate.status.value)
        assertEquals(0, dir.listFiles()!!.size)
        // Mauvaise taille.
        assertNull(AppUpdate.fetch(dir, FakeNet(bytes = apk + 1), null, rel(sha = null)) { true })
        assertEquals(Status.Failed(Reason.BAD_FILE, "taille"), AppUpdate.status.value)
        // Pas la bonne appli (autre signature, autre paquet).
        assertNull(AppUpdate.fetch(dir, FakeNet(bytes = apk), null, rel()) { false })
        assertEquals(Status.Failed(Reason.WRONG_APP), AppUpdate.status.value)
        assertEquals(0, dir.listFiles()!!.size)
    }

    @Test
    fun downloadErrorsAreNamed() = runBlocking {
        val dir = File(tmp.root, "maj")
        assertNull(AppUpdate.fetch(dir, FakeNet(code = 404), null, rel()) { true })
        assertEquals(Status.Failed(Reason.PRIVATE), AppUpdate.status.value)
        assertNull(AppUpdate.fetch(dir, FakeNet(code = 500), null, rel()) { true })
        assertEquals(Status.Failed(Reason.NETWORK, "HTTP 500"), AppUpdate.status.value)
        assertNull(AppUpdate.fetch(dir, FakeNet(fail = IOException("coupe")), null, rel()) { true })
        assertEquals(Status.Failed(Reason.NETWORK, "coupe"), AppUpdate.status.value)
    }

    @Test
    fun aDownloadThatIsCutShortGoesBackToAvailableInsteadOfStayingOnDownloading() = runBlocking {
        // L'ecran qui l'avait lance disparait (defilement, autre onglet) : la coroutine est annulee en route.
        val dir = File(tmp.root, "maj")
        val release = rel()
        val started = CompletableDeferred<Unit>()
        val net = object : AppUpdate.Net {
            override suspend fun releases(token: String?) = AppUpdate.Listing(200, "[]")
            override suspend fun download(assetId: Long, token: String?, dest: File, onProgress: (Long, Long) -> Unit): Int {
                dest.writeBytes(apk.copyOf(3))
                onProgress(3, apk.size.toLong())
                started.complete(Unit)
                awaitCancellation()
            }
        }
        val job = launch { AppUpdate.fetch(dir, net, null, release) { true } }
        started.await()
        assertTrue(AppUpdate.status.value is Status.Downloading)
        job.cancelAndJoin()
        // Sans cela, l'etat restait a « telechargement » pour tout le processus : plus de bouton, plus de recherche.
        assertEquals(Status.Available(release), AppUpdate.status.value)
        assertEquals(0, dir.listFiles()!!.size)
    }

    @Test
    fun aRedirectIsOnlyFollowedToGitHubOverHttps() {
        assertTrue(AppUpdate.trustedRedirect("https://release-assets.githubusercontent.com/github-production-release-asset/1?sig=x"))
        assertTrue(AppUpdate.trustedRedirect("https://objects.githubusercontent.com/x"))
        assertTrue(AppUpdate.trustedRedirect("https://github.com/diasLamka/x/releases/download/a/b.apk"))
        assertFalse(AppUpdate.trustedRedirect("http://objects.githubusercontent.com/x"))
        assertFalse(AppUpdate.trustedRedirect("https://evil.example/githubusercontent.com"))
        assertFalse(AppUpdate.trustedRedirect("https://githubusercontent.com.evil.example/x"))
        assertFalse(AppUpdate.trustedRedirect("https://evilgithub.com/x"))
        assertFalse(AppUpdate.trustedRedirect("ftp://github.com/x"))
        assertFalse(AppUpdate.trustedRedirect(null))
        assertFalse(AppUpdate.trustedRedirect("pas une adresse"))
    }

    /* ---------------------------------------------------------------- jeton */

    @Test
    fun onlyTokenShapedTextIsKept() {
        assertEquals("github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz", UpdateToken.plausible("  github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz\n"))
        assertEquals("ghp_abcdefghijklmnopqrstuvwxyz0123456789", UpdateToken.plausible("ghp_abcdefghijklmnopqrstuvwxyz0123456789"))
        assertNull(UpdateToken.plausible(""))
        assertNull(UpdateToken.plausible("court"))
        assertNull(UpdateToken.plausible("avec des espaces dedans, et ça ne va pas du tout"))
        assertNull(UpdateToken.plausible("a".repeat(300)))
        assertNull(UpdateToken.plausible(null))
    }
}

/**
 * Le vrai client reseau, contre de vrais serveurs locaux : le jeton va au premier
 * serveur (l'API), JAMAIS au second (l'adresse signee de telechargement), et une
 * redirection hors de GitHub n'est pas suivie.
 */
class UpdateNetTest {
    @get:Rule val tmp = TemporaryFolder()
    private val sockets = mutableListOf<java.net.ServerSocket>()

    @org.junit.After
    fun stop() { sockets.forEach { runCatching { it.close() } } }

    /** Une requete vue par le serveur : la premiere ligne et ses en-tetes. */
    private class Seen(val line: String, val headers: Map<String, String>)

    private class Reply(val status: Int, val headers: Map<String, String> = emptyMap(), val body: String = "")

    /** Un mini-serveur HTTP : une reponse par connexion, rien d'autre. */
    private fun serve(seen: MutableList<Seen> = mutableListOf(), reply: (Seen) -> Reply): String {
        val server = java.net.ServerSocket(0, 10, java.net.InetAddress.getByName("127.0.0.1"))
        sockets.add(server)
        Thread {
            while (!server.isClosed) {
                val c = try { server.accept() } catch (_: Exception) { break }
                try {
                    val reader = c.getInputStream().bufferedReader()
                    val line = reader.readLine() ?: continue
                    val headers = mutableMapOf<String, String>()
                    while (true) {
                        val h = reader.readLine() ?: break
                        if (h.isEmpty()) break
                        headers[h.substringBefore(':').trim().lowercase()] = h.substringAfter(':').trim()
                    }
                    val req = Seen(line, headers)
                    synchronized(seen) { seen.add(req) }
                    val r = reply(req)
                    val out = c.getOutputStream()
                    val body = r.body.toByteArray()
                    val head = StringBuilder("HTTP/1.1 ${r.status} X\r\nContent-Length: ${body.size}\r\nConnection: close\r\n")
                    r.headers.forEach { (k, v) -> head.append("$k: $v\r\n") }
                    head.append("\r\n")
                    out.write(head.toString().toByteArray()); out.write(body); out.flush()
                } catch (_: Exception) {
                } finally {
                    runCatching { c.close() }
                }
            }
        }.apply { isDaemon = true; start() }
        return "http://127.0.0.1:${server.localPort}"
    }

    private val client = okhttp3.OkHttpClient()

    @Test
    fun theTokenReachesTheApiAndNeverTheSignedDownloadAddress() = runBlocking {
        val cdnSeen = mutableListOf<Seen>()
        val apiSeen = mutableListOf<Seen>()
        val cdn = serve(cdnSeen) { Reply(200, body = "octet") }
        val api = serve(apiSeen) { Reply(302, mapOf("Location" to "$cdn/fichier?sig=abc")) }
        val dest = File(tmp.root, "a.apk")
        val code = AppUpdate.OkNet(client, api, trust = { true }).download(7, "jeton-secret", dest) { _, _ -> }
        assertEquals(200, code)
        assertEquals("octet", dest.readText())
        assertEquals("Bearer jeton-secret", apiSeen.single().headers["authorization"])
        assertTrue(apiSeen.single().line.contains("/releases/assets/7"))
        assertEquals("application/octet-stream", apiSeen.single().headers["accept"])
        assertNull("le jeton ne doit pas suivre la redirection", cdnSeen.single().headers["authorization"])
    }

    @Test
    fun aRedirectOutsideGitHubIsNotFollowed() = runBlocking {
        val evilSeen = mutableListOf<Seen>()
        val evil = serve(evilSeen) { Reply(200, body = "x") }
        val api = serve { Reply(302, mapOf("Location" to "$evil/x")) }
        val code = AppUpdate.OkNet(client, api).download(7, "jeton-secret", File(tmp.root, "b.apk")) { _, _ -> }
        assertEquals(0, code)
        assertTrue("rien ne doit etre demande a un hote hors GitHub", evilSeen.isEmpty())
    }

    @Test
    fun theListingCarriesTheTokenAndReadsTheRateLimit() = runBlocking {
        val seen = mutableListOf<Seen>()
        val api = serve(seen) { Reply(403, mapOf("x-ratelimit-remaining" to "0"), "{}") }
        val r = AppUpdate.OkNet(client, api).releases("jeton-secret")
        assertEquals("Bearer jeton-secret", seen.single().headers["authorization"])
        assertEquals(403, r.code)
        assertTrue(r.rateLimited)
        AppUpdate.OkNet(client, api).releases(null)
        assertNull("sans jeton, aucun en-tete d'autorisation", seen.last().headers["authorization"])
    }
    /* ----------------------------------------- la confirmation (1.26.0) */

    @Test
    fun androidSkipsTheConfirmationOnlyWhenTheAppIsItsOwnInstaller() {
        val me = "io.github.diaslamka.freegames"
        assertEquals("avant Android 12 le systeme demande toujours", Silence.ASKS_ALWAYS, Install.silence(30, true, me, me))
        assertEquals("sans l'autorisation, rien ne s'installe", Silence.NEEDS_PERMISSION, Install.silence(34, false, me, me))
        assertEquals("installee par le navigateur : une confirmation, une fois", Silence.FIRST_TIME, Install.silence(34, true, "com.android.chrome", me))
        assertEquals("installateur inconnu : pareil", Silence.FIRST_TIME, Install.silence(34, true, null, me))
        assertEquals("installee par l'appli : sans confirmation", Silence.SILENT, Install.silence(34, true, me, me))
        assertEquals("Android 12 pile", Silence.SILENT, Install.silence(31, true, me, me))
    }

    @Test
    fun theManifestDeclaresTheRightToUpdateWithoutAsking() {
        // Oubliee jusqu'a 1.25.0 : Android 12+ demandait alors TOUJOURS confirmation, meme pour l'installateur d'origine.
        val manifest = java.io.File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION"))
        assertTrue(manifest.contains("android.permission.REQUEST_INSTALL_PACKAGES"))
    }
}
