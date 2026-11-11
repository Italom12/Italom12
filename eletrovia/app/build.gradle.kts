plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.italom.eletrovia"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.italom.eletrovia"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "1.1.0"
    }

    // A chave de assinatura NÃO fica no repositório (ele é público). Coloque o arquivo
    // eletrovia.jks em keystore/ para gerar APKs que atualizam por cima da versão instalada;
    // sem ele, o build usa a chave de debug do Android.
    val ks = rootProject.file("keystore/eletrovia.jks")
    signingConfigs {
        if (ks.exists()) {
            create("release") {
                storeFile = ks
                storePassword = System.getenv("ELETROVIA_KS_PASS") ?: "eletrovia"
                keyAlias = "eletrovia"
                keyPassword = System.getenv("ELETROVIA_KS_PASS") ?: "eletrovia"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    androidResources {
        noCompress += listOf("json")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
