package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Accounts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AccountsTest {
    @Test
    fun googleAndFacebookSignInPagesAreRefused() {
        assertEquals("Google", Accounts.refusedProvider("https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=y"))
        assertEquals("Google", Accounts.refusedProvider("https://accounts.google.com/signin/oauth/identifier?x=1"))
        assertEquals("Google", Accounts.refusedProvider("https://www.google.com/o/oauth2/auth?x=1"))
        assertEquals("Facebook", Accounts.refusedProvider("https://www.facebook.com/v19.0/dialog/oauth?client_id=1"))
        assertEquals("Facebook", Accounts.refusedProvider("https://m.facebook.com/login/?next=x"))
    }

    @Test
    fun storePagesAndLookalikesPass() {
        assertNull(Accounts.refusedProvider("https://www.epicgames.com/id/login?redirectUrl=https%3A%2F%2Fstore.epicgames.com%2F"))
        assertNull(Accounts.refusedProvider("https://www.epicgames.com/id/login/google"))
        assertNull(Accounts.refusedProvider("https://www.gog.com/#openlogin"))
        assertNull(Accounts.refusedProvider("https://accounts.google.com.evil.test/o/oauth2"))
        assertNull(Accounts.refusedProvider("https://www.google.com/search?q=epic"))
        assertNull(Accounts.refusedProvider("https://www.facebook.com/epicgames"))
        assertNull(Accounts.refusedProvider("not a url"))
        assertNull(Accounts.refusedProvider(null))
    }
}
