package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.EpicMobileSource
import io.github.diaslamka.freegames.sources.EpicSource
import io.github.diaslamka.freegames.sources.GamerPowerSource
import io.github.diaslamka.freegames.sources.GogSource
import io.github.diaslamka.freegames.sources.SteamSource
import io.github.diaslamka.freegames.sources.parseJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant

/** Les memes captures que les tests de l'extension, les memes attentes. */
class SourcesTest {
    private fun fixture(name: String) = File(System.getProperty("fixtures"), name).readText()
    private fun at(iso: String) = Instant.parse(iso).toEpochMilli()

    @Test
    fun epicKeepsOnlyTheGiftedGame() {
        val t = at("2026-08-27T10:00:00Z")
        val r = EpicSource.parse(fixture("epic-freegames.json"), t)!!
        assertEquals(1, r.offers.size)
        val o = r.offers[0]
        assertEquals("cardpocalypse", o.storeId)
        assertEquals("https://store.epicgames.com/p/cardpocalypse?lang=fr", o.url)
        assertTrue(o.worth!!.contains("23,99"))
        assertEquals(true, o.keepable)
        assertEquals(at("2026-08-20T15:00:00Z"), o.start)
        assertEquals(at("2026-08-27T15:00:00Z"), o.end)
    }

    @Test
    fun epicReadsUpcomingWindowsSorted() {
        val t = at("2026-08-27T10:00:00Z")
        val up = EpicSource.parse(fixture("epic-freegames.json"), t)!!.upcoming
        assertTrue(up.size >= 5)
        assertEquals(at("2026-08-27T15:00:00Z"), up[0].start)
        for (i in 1 until up.size) assertTrue(up[i - 1].start <= up[i].start)
    }

    @Test
    fun epicSlugRules() {
        assertEquals("cardpocalypse", EpicSource.normaliseSlug("cardpocalypse/home"))
        assertNull(EpicSource.normaliseSlug("[]"))
        assertNull(EpicSource.normaliseSlug("0123456789abcdef0123456789abcdef"))
        assertEquals(true, EpicSource.isFreeToKeep(parseJson("""{"price":{"totalPrice":{"originalPrice":2399,"discountPrice":0}}}""")))
        assertEquals(false, EpicSource.isFreeToKeep(parseJson("""{"price":{"totalPrice":{"originalPrice":0,"discountPrice":0}}}""")))
        assertEquals(false, EpicSource.isFreeToKeep(parseJson("""{"price":{"totalPrice":{"originalPrice":2399,"discountPrice":2399}}}""")))
        assertNull(EpicSource.isFreeToKeep(parseJson("{}")))
    }

    @Test
    fun gogReadsTheCatalog() {
        val t = at("2026-09-17T12:00:00Z")
        val r = GogSource.parse(fixture("gog-filtered.json"), t)!!
        val offert = r.offers.first { it.storeId == "offert" }
        assertEquals("Un Jeu Offert", offert.title)
        assertEquals("https://www.gog.com/fr/game/offworld_trading_company_market_corrections", offert.url)
        assertEquals("9.99 EUR", offert.worth)
        assertEquals(1789700000L * 1000, offert.end)
        assertTrue(offert.image!!.endsWith(".jpg"))
        assertTrue(r.offers.none { it.keepable == false })
    }

    @Test
    fun gamerpowerDatesAreNewYorkTime() {
        val o = GamerPowerSource.mapEntry(
            parseJson(
                """{"id":42,"title":"Jeu Minimal (Epic Games) Giveaway","open_giveaway_url":"https://www.gamerpower.com/open/jeu-minimal",
                "published_date":"2026-08-26 21:23:06","end_date":"N/A"}""",
            ),
            0,
        )!!
        assertEquals("42", o.sourceId)
        assertEquals(Stores.EPIC, o.store)
        assertEquals("jeu minimal", o.normalisedTitle)
        assertNull(o.end)
        assertEquals(at("2026-08-27T01:23:06Z"), o.start)
    }

    @Test
    fun gamerpowerReadsTheWholeCapture() {
        val body = fixture("gamerpower-giveaways.json")
        val r = GamerPowerSource.parse(body, at("2026-08-27T10:00:00Z"))!!
        assertEquals(parseJson(body)!!.let { (it as kotlinx.serialization.json.JsonArray).size }, r.offers.size)
        assertTrue(r.offers.all { it.url == null && it.resolveUrl != null })
    }

    @Test
    fun epicMobileReadsMindcop() {
        // Avant la fin publiee (2026-09-24T15:00Z) : la fin se lit.
        val t = at("2026-09-24T10:00:00Z")
        val android = EpicMobileSource.freeTopicOffers(parseJson(fixture("epic-mobile-discover-android.json")))!!
        val ios = EpicMobileSource.freeTopicOffers(parseJson(fixture("epic-mobile-discover-ios.json")))!!
        val offers = EpicMobileSource.mapOffers(mapOf("android" to android, "ios" to ios), t)
        val m = offers.first { it.title == "Mindcop" }
        assertEquals(Stores.EPIC_MOBILE, m.store)
        assertEquals("Android, iOS", m.platforms)
        assertNotNull(m.image)
        assertEquals(at("2026-09-24T15:00:00Z"), m.end)
        val futur = "2026-10-01T15:00:00Z"
        assertEquals(at(futur), EpicMobileSource.readEnd(parseJson("""{"discount":{"discountEndDate":"$futur"}}"""), t))
        assertEquals(at(futur), EpicMobileSource.readEnd(parseJson("""{"expiresAt":"$futur"}"""), t))
        assertNull(EpicMobileSource.readEnd(parseJson("""{"weekend":"$futur","legend":"$futur","startDate":"$futur"}"""), t))
        assertNull(EpicMobileSource.readEnd(parseJson("""{"endDate":"2026-01-01T00:00:00Z"}"""), t))
        assertEquals(at(futur), EpicMobileSource.readEnd(parseJson("""{"endsAt":${at(futur)}}"""), t))
        assertEquals("calico", EpicMobileSource.baseSlug("calico-android-83faf9"))
        assertEquals("android-quest", EpicMobileSource.baseSlug("android-quest"))
    }

    @Test
    fun steamKeepsOnlyFreeToKeep() {
        val item = parseJson(
            """{"appid":4059370,"name":"X","type":4,"related_items":{"parent_appid":3674980},
            "best_purchase_option":{"is_free_to_keep":true,"packageid":1843288,"free_to_keep_ends":1790000000,
            "formatted_original_price":"1,99€"},
            "assets":{"asset_url_format":"steam/apps/4059370/${'$'}{FILENAME}?t=1","header":"abc/header.jpg"}}""",
        )
        val o = SteamSource.mapItem(item, 0)!!
        assertEquals("1843288", o.packageId)
        assertEquals("3674980", o.parentAppid)
        assertEquals("DLC", o.category)
        assertEquals(1790000000L * 1000, o.end)
        assertEquals("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4059370/abc/header.jpg?t=1", o.image)
        assertNull(SteamSource.mapItem(parseJson("""{"appid":730,"name":"CS2","is_free":true}"""), 0))
        assertEquals(listOf("1", "22"), SteamSource.extractAppIds("""<a data-ds-appid="1"></a><a data-ds-appid="22"></a><a data-ds-appid="1">"""))
    }
}
