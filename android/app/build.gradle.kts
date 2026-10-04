import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

/* Le moteur de recuperation est celui de l'extension, au caractere pres : il
   est recopie a chaque build depuis le depot, jamais edite ici. */
val repoRoot = rootProject.projectDir.parentFile

/* La version du moteur embarque, lue dans package.json de l'extension. */
val engineVersion: String = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
    .find(repoRoot.resolve("package.json").readText())?.groupValues?.get(1) ?: "?"

abstract class CopyEngineTask : DefaultTask() {
    @get:InputFiles
    abstract val engineFiles: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copy() {
        val out = outputDir.get().asFile.resolve("engine")
        out.deleteRecursively()
        out.mkdirs()
        engineFiles.files.forEach { it.copyTo(out.resolve(it.name), overwrite = true) }
    }
}

/* Le systeme Android de Robolectric, telecharge par Gradle plutot que par
   Robolectric lui-meme (son propre client se fait limiter par Maven Central). */
val robolectricAndroid: Configuration by configurations.creating
val robolectricJars = layout.buildDirectory.dir("robolectric-jars")
val fetchRobolectric = tasks.register<Copy>("fetchRobolectric") {
    from(robolectricAndroid)
    into(robolectricJars)
}

val copyEngine = tasks.register<CopyEngineTask>("copyEngine") {
    engineFiles.from(
        repoRoot.resolve("content/free-games-claimer.js"),
        repoRoot.resolve("watch/steam-claim.js"),
    )
}

/* La cle de signature : la meme a chaque build, pour qu'une nouvelle version
   s'installe par-dessus l'ancienne. Absente, le build de release n'est pas signe. */
val signing = Properties().apply {
    val f = rootProject.file("keystore/keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "io.github.diaslamka.freegames"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.diaslamka.freegames"
        minSdk = 26
        targetSdk = 36
        versionCode = 33
        versionName = "1.27.1"
        buildConfigField("String", "ENGINE_VERSION", "\"$engineVersion\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (signing.getProperty("storeFile") != null) {
            create("release") {
                storeFile = rootProject.file("keystore/" + signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "META-INF/versions/9/OSGI-INF/MANIFEST.MF")
    }

    androidResources {
        localeFilters += listOf("en", "fr", "de", "es")
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all {
            // Les tests lisent les MEMES captures que ceux de l'extension.
            it.systemProperty("fixtures", repoRoot.resolve("test/fixtures").absolutePath)
            // Les captures d'ecran des ecrans (ScreenshotTest), hors du depot.
            it.systemProperty("roborazzi.test.record", "true")
            it.systemProperty("fgc.screens", providers.gradleProperty("screens").getOrElse("false"))
            it.systemProperty("robolectric.offline", "true")
            it.systemProperty("robolectric.dependency.dir", robolectricJars.get().asFile.absolutePath)
            it.dependsOn(fetchRobolectric)
            it.systemProperty("screenshots", layout.buildDirectory.dir("screenshots").get().asFile.absolutePath)
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyEngine, CopyEngineTask::outputDir)
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.09.00")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.work:work-runtime-ktx:2.10.5")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("io.coil-kt.coil3:coil-compose:3.3.0")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.3.0")
    implementation("com.squareup.okhttp3:okhttp:5.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    /* Le lecteur de QR code de Google Play : il ouvre SA camera, dans son processus.
       L'appli n'a donc pas a demander la permission CAMERA. */
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation(composeBom)
    testImplementation("org.robolectric:robolectric:4.16")
    testImplementation("androidx.test.ext:junit:1.3.0")
    testImplementation("androidx.work:work-testing:2.10.5")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.52.0")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:1.52.0")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    /* Les tests sur emulateur (src/androidTest) : le vrai systeme, pas Robolectric. */
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:rules:1.7.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    robolectricAndroid("org.robolectric:android-all-instrumented:15-robolectric-13954326-i7") { isTransitive = false }
}
