package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.FabSource
import io.github.diaslamka.freegames.sources.HttpResult
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.time.Instant

/**
 * La source Fab, portage de watch/sources/fab.js : les memes captures que les tests de l'extension
 * (test/fixtures/fab-limited-free.html, mesuree le 2026-10-10), les memes attentes.
 */
class FabSourceTest {
    private fun fixture(name: String) = File(System.getProperty("fixtures"), name).readText()
    private fun at(iso: String) = Instant.parse(iso).toEpochMilli()

    private val debut = at("2026-10-06T14:00:00Z")
    private val fin = at("2026-10-20T13:59:00Z")
    private val t = at("2026-10-10T12:00:00Z")

    private val readMap = "95ff3c25-59f9-441d-aa43-93c3abd63680"
    private val pathfinding = "e57ff036-fb84-4c86-af7d-8c2a75965c73"
    private val farm = "d8b51a6c-a5b2-41cf-8f49-14e936a27de3"

    private val page get() = fixture("fab-limited-free.html")
    private fun blade() = FabSource.readBlade(page)!!

    /* ---------------------------------------------------- de petites pages sur mesure */

    private fun lic(
        slug: String, price: Double, disc: Double = 0.0, start: String = "2026-10-06T14:00:00Z",
        end: String = "2026-10-20T13:59:00Z", cur: String = "EUR",
    ) = """{"name":"$slug","slug":"$slug","group":"standard","offerId":"o-$slug","uid":"u-$slug",
        "priceTier":{"currencyCode":"$cur","price":$price,"discountedPrice":$disc,"discountStartDate":"$start","discountEndDate":"$end"}}"""

    private fun tile(uid: String, title: String, vararg lics: String, extra: String = "") =
        """{"listing":{"uid":"$uid","title":"$title","user":{"sellerName":"Studio"},
        "assetFormats":[{"assetFormatType":{"name":"Unreal Engine"}},{"assetFormatType":{"name":"Unreal Engine"}},{"assetFormatType":{"name":"Unity"}}],
        "thumbnails":[{"mediaUrl":"https://media.fab.com/x/base.jpg","images":[
          {"width":144,"url":"https://media.fab.com/x/144.jpg"},{"width":1920,"url":"https://media.fab.com/x/1920.jpg"},
          {"width":640,"url":"https://media.fab.com/x/640.jpg"}]}],
        "licenses":[${lics.joinToString(",")}]$extra}}"""

    private fun pageOf(vararg tiles: String, limited: Boolean = true) =
        """<html><body><script id="js-json-data-prefetched-data" type="application/json">
        {"/i/blades/free_content_blade":{"isLimitedFreeContent":$limited,"tiles":[${tiles.joinToString(",")}]}}</script></body></html>"""

    private fun offersOf(html: String, now: Long = t) = FabSource.mapOffers(FabSource.readBlade(html), now)

    private val uidA = "11111111-1111-4111-8111-111111111111"
    private val uidB = "22222222-2222-4222-8222-222222222222"

    /* ---------------------------------------------------- la lecture */

    @Test
    fun theCaptureHoldsThreeListingsInTheLimitedFreeBlade() {
        val tiles = blade()["tiles"].arr!!
        assertEquals(listOf(readMap, pathfinding, farm), tiles.map { it["listing"]["uid"].str })
    }

    @Test
    fun aPageWithoutTheBladeIsNullNotNoOffer() {
        assertNull(FabSource.readBlade("<html><body>Fab</body></html>"))
        assertNull(FabSource.readBlade("""<script id="js-json-data-prefetched-data" type="application/json">{pas du json</script>"""))
        assertNull(FabSource.readBlade("""<script id="js-json-data-prefetched-data" type="application/json">{"/i/users/me":{}}</script>"""))
        assertNull(FabSource.readBlade(pageOf(tile(uidA, "A", lic("personal", 10.0)), limited = false)))
        assertNull(FabSource.readBlade(""))
        assertNull(FabSource.readBlade(null))
    }

    @Test
    fun aQuotedTagDoesNotHideTheRealOne() {
        val html = """<!-- <script id="js-json-data-prefetched-data"> -->""" + pageOf(tile(uidA, "A", lic("personal", 10.0)))
        assertNotNull(FabSource.readBlade(html))
    }

    @Test
    fun anEmptyBladeIsReadableAndEmpty() {
        val m = offersOf(pageOf())
        assertTrue(m.offers.isEmpty())
        assertTrue(m.dropped.isEmpty())
    }

    @Test
    fun theListingAddressIsWellFormedOrNothing() {
        assertEquals("https://www.fab.com/listings/$farm", FabSource.listingUrl(farm))
        assertEquals("https://www.fab.com/listings/$farm", FabSource.listingUrl(farm.uppercase()))
        assertNull(FabSource.listingUrl("../etc/passwd"))
        assertNull(FabSource.listingUrl(""))
        assertNull(FabSource.listingUrl(null))
    }

    /* ---------------------------------------------------- les offres */

    @Test
    fun theRealPageGivesThreeOffersWithEndWorthThumbnailAndListing() {
        val m = FabSource.mapOffers(blade(), t)
        assertEquals(0, m.dropped.size)
        assertEquals(3, m.offers.size)

        val o = m.offers[0]
        assertEquals("fab:$readMap", o.key)
        assertEquals("fab", o.source)
        assertEquals(Stores.FAB, o.store)
        assertEquals(readMap, o.storeId)
        assertEquals("fab:$readMap", o.sourceId)
        assertEquals("Ready Map Vol 2 - Bridge Environment / Nature", o.title)
        assertEquals("https://www.fab.com/listings/$readMap", o.url)
        assertEquals(debut, o.start)
        assertEquals(fin, o.end)
        assertEquals("80.32 EUR", o.worth)
        assertEquals("Six Sides Studios", o.publisher)
        assertEquals("Unreal Engine", o.platforms)
        assertEquals("asset", o.category)
        assertEquals(true, o.keepable)
        assertEquals(t, o.firstSeen)
        assertEquals(t, o.lastSeen)
        assertTrue(Regex("^https://media\\.fab\\.com/image_previews/gallery_images/.+\\.jpg$").matches(o.image.orEmpty()))

        assertEquals(listOf("80.32 EUR", "89.24 EUR", "17.84 EUR"), m.offers.map { it.worth })
        assertEquals(listOf("Six Sides Studios", "NordVader", "Emberlight Creations"), m.offers.map { it.publisher })
    }

    @Test
    fun theThumbnailIsTheMiddleSize() {
        val images = blade()["tiles"][0]["listing"]["thumbnails"][0]["images"].arr!!
        val expected = images.first { it["width"].toString() == "640" }["url"].str
        assertEquals(expected, FabSource.mapOffers(blade(), t).offers[0].image)
        // Sur mesure : ni la miniature, ni le plein ecran, ni la base.
        assertEquals("https://media.fab.com/x/640.jpg", offersOf(pageOf(tile(uidA, "A", lic("personal", 10.0)))).offers[0].image)
    }

    @Test
    fun theEndIsTheNearestOfTheFreeLicencesAndTheStartTheEarliest() {
        val m = offersOf(pageOf(tile(
            uidA, "A",
            lic("personal", 10.0, end = "2026-10-20T13:59:00Z", start = "2026-10-06T14:00:00Z"),
            lic("professional", 30.0, end = "2026-10-15T08:00:00Z", start = "2026-10-05T10:00:00Z"),
        )))
        assertEquals(at("2026-10-15T08:00:00Z"), m.offers[0].end)
        assertEquals(at("2026-10-05T10:00:00Z"), m.offers[0].start)
    }

    @Test
    fun aPaidLicenceDoesNotCount() {
        val m = offersOf(pageOf(tile(
            uidA, "A",
            lic("personal", 10.0, disc = 5.0, end = "2026-10-11T00:00:00Z"),
            lic("professional", 30.0),
        )))
        assertEquals(1, m.offers.size)
        assertEquals(fin, m.offers[0].end)
        assertEquals("30.00 EUR", m.offers[0].worth)
    }

    @Test
    fun thePersonalLicenceSetsTheWorthWhenFree() {
        val m = offersOf(pageOf(tile(uidA, "A", lic("professional", 30.0), lic("personal", 10.0))))
        assertEquals("10.00 EUR", m.offers[0].worth)
    }

    @Test
    fun noFreeLicenceMeansDroppedWithItsReason() {
        val m = offersOf(pageOf(tile(uidA, "A", lic("personal", 10.0)), tile(uidB, "B", lic("personal", 10.0, disc = 10.0))))
        assertEquals(listOf(uidA), m.offers.map { it.storeId })
        assertEquals(listOf(uidB to "aucune licence gratuite"), m.dropped.map { it.uid to it.reason })
    }

    @Test
    fun anEndedOrNotYetStartedDiscountIsNotAnOpenOffer() {
        val html = pageOf(tile(uidA, "A", lic("personal", 10.0)))
        val after = offersOf(html, fin + 1)
        assertTrue(after.offers.isEmpty())
        assertEquals("remise terminee", after.dropped.single().reason)
        val before = offersOf(html, debut - 3_600_000)
        assertTrue(before.offers.isEmpty())
        assertEquals("remise a venir", before.dropped.single().reason)
    }

    @Test
    fun aFreeAnywayListingHasNothingToKeep() {
        val m = offersOf(pageOf(tile(uidA, "A", lic("personal", 0.0, disc = 0.0))))
        assertTrue(m.offers.isEmpty())
        assertEquals(uidA, m.dropped.single().uid)
    }

    @Test
    fun aListingWithoutAWellFormedIdOrATitleIsDroppedNeverInvented() {
        val m = offersOf(pageOf(tile("../x", "A", lic("personal", 10.0)), tile(uidA, "   ", lic("personal", 10.0)), tile(uidB, "B", lic("personal", 10.0))))
        assertEquals(listOf(uidB), m.offers.map { it.storeId })
        assertEquals(2, m.dropped.size)
    }

    @Test
    fun missingOrMistypedFieldsDoNotBringTheReadingDown() {
        val html = """<script id="js-json-data-prefetched-data" type="application/json">{"/i/blades/free_content_blade":{"isLimitedFreeContent":true,"tiles":[
            {"listing":{"uid":"$uidA","title":"A","licenses":[${lic("personal", 10.0)}]}},
            {"listing":null},
            {"listing":{"uid":"$uidB","title":"B","licenses":"x"}},
            "oops", 7]}}</script>"""
        val m = offersOf(html)
        assertEquals(1, m.offers.size)
        val o = m.offers[0]
        assertNull(o.image)
        assertNull(o.publisher)
        assertNull(o.platforms)
        // Le `null`, la licence qui n'est pas une liste, et les deux tuiles qui ne sont pas des objets.
        assertEquals(4, m.dropped.size)
    }

    @Test
    fun theWorthNeedsAThreeLetterCurrency() {
        val m = offersOf(pageOf(tile(uidA, "A", lic("personal", 10.0, cur = "euro"))))
        assertNull(m.offers[0].worth)
    }

    @Test
    fun theFormatsAreListedOnceEach() {
        assertEquals("Unreal Engine, Unity", offersOf(pageOf(tile(uidA, "A", lic("personal", 10.0)))).offers[0].platforms)
    }

    /* ---------------------------------------------------- la decouverte */

    private class FakeFetcher(private val answer: () -> HttpResult) : Fetcher {
        val seen = mutableListOf<Triple<String, Boolean, String>>()
        override suspend fun get(url: String, withCookies: Boolean, accept: String): HttpResult {
            seen += Triple(url, withCookies, accept)
            return answer()
        }
    }

    @Test
    fun theWholePageIsReadWithoutCookiesAtTheMeasuredAddress() = runBlocking {
        val f = FakeFetcher { HttpResult(200, page) }
        val r = FabSource.discover(f, t)
        assertTrue(r.ok)
        assertTrue(r.errors.isEmpty())
        assertEquals(3, r.offers.size)
        assertEquals(1, f.seen.size)
        assertEquals("https://www.fab.com/limited-time-free", FabSource.PAGE_URL)
        assertEquals(FabSource.PAGE_URL, f.seen[0].first)
        assertFalse("une lecture anonyme, jamais la session de l'utilisateur", f.seen[0].second)
        assertTrue(f.seen[0].third.contains("text/html"))
    }

    @Test
    fun noOfferThisWeekIsAnEmptyListThatIsStillOk() = runBlocking {
        val r = FabSource.discover(FakeFetcher { HttpResult(200, pageOf()) }, t)
        assertTrue(r.ok)
        assertTrue(r.offers.isEmpty())
    }

    @Test
    fun anHttpErrorIsAnErrorThatSaysSo() = runBlocking {
        val r = FabSource.discover(FakeFetcher { HttpResult(403, "") }, t)
        assertFalse(r.ok)
        assertTrue(r.offers.isEmpty())
        assertEquals(listOf("HTTP 403"), r.errors)
    }

    @Test
    fun aNetworkFailureIsAnErrorNotAnException() = runBlocking {
        val r = FabSource.discover(FakeFetcher { throw IOException("reseau") }, t)
        assertFalse(r.ok)
        assertEquals(listOf("reseau"), r.errors)
    }

    @Test
    fun aChangedPageIsAnErrorNeverNoOffer() = runBlocking {
        val r = FabSource.discover(FakeFetcher { HttpResult(200, "<html><body>Un defi Cloudflare</body></html>") }, t)
        assertFalse(r.ok)
        assertTrue(r.offers.isEmpty())
        assertTrue(r.errors[0].contains("bloc des offres absent"))
    }

    /* ---------------------------------------------------- le magasin et les regles */

    @Test
    fun fabIsAStoreWithItsNameItsHostAndNoClaimModule() {
        assertEquals("fab", Stores.FAB)
        assertEquals("Fab (Epic)", Stores.label(Stores.FAB))
        assertEquals(Stores.FAB, Titles.storeFromUrl("https://www.fab.com/listings/$farm"))
        assertEquals(Stores.FAB, Titles.storeFromUrl("https://fab.com/limited-time-free"))
        assertFalse(Titles.storeFromUrl("https://notfab.com/x") == Stores.FAB)
        assertFalse(Stores.FAB in Stores.ENGINE)
    }

    @Test
    fun fabIsNeverClaimedWhateverTheSettings() {
        val everything = Settings(claimEpic = true, claimGog = true, claimAmazon = true, claimSteam = true)
        val o = FabSource.mapOffers(blade(), t).offers[0]
        assertFalse(Rules.storeEnabled(Stores.FAB, everything))
        assertFalse(Rules.claimable(o, everything))
    }

    @Test
    fun followingFabIsOffByDefault() {
        assertFalse(Settings().showFab)
    }

    @Test
    fun anOfferAFabListingKeepsItsKeyAcrossPasses() {
        val a = FabSource.mapOffers(blade(), t).offers[0]
        val b = FabSource.mapOffers(blade(), t + 3_600_000).offers[0]
        assertEquals(a.key, b.key)
        assertEquals(Offer.keyFor(Stores.FAB, readMap, a.title), a.key)
    }
}
